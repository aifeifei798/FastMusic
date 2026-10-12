import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { parseFile } from 'music-metadata';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable CORS and JSON parsing
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
}));
app.use(express.json());

// ================= 配置与支持格式 =================
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.webm', '.wav', '.ogg', '.m4a']);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi']);
const ALL_MEDIA_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

export interface ServerMediaItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  media_type: 'audio' | 'video';
  ext: string;
  file_size: number;
  stream_url: string;
  duration?: number;
  cover_url?: string;
  abs_path?: string;
  mtime?: number; // 文件 mtimeMs，用于增量去重（已入库且未变更则 skip 重解析）
  transcode?: TranscodeInfo; // 仅响应里附带（不落库），列表显示转码状态
  lyric?: 'yes' | 'no' | null; // 仅响应里附带：歌词缓存里是否有该曲的歌词（null = 未查过）
}

// In-Memory Database Map: key is media_id
const MEDIA_DB = new Map<string, ServerMediaItem>();

// 持久本地数据库：扫描一次写到磁盘，重启 不再 清空；增量去重 skip 已入库未变更文件
const DB_FILE = path.join(__dirname, 'fastmusic_db.json');

// 本地媒体流服务端。核心难点：本机 Chrome 跳过 NVIDIA 的 VA-API 硬解设备，
// MP4/H.264 走的正是这条被跳过的解码路径 → 黑屏有声。
// 因此所有 .mkv 统一经下方的转码引擎转成 WebM 侧车文件再流式播放。
// ============================================================
// MKV → WebM 转码引擎（AV1/VP9 源走无损 remux，其余走 VP9 重编码）
// ============================================================
// 为什么要转 WebM：本机 Chrome 跳过了 NVIDIA 的 VA-API 硬解设备
// (vaapi_wrapper: "Should skip nVidia device named: nvidia-drm")，
// 而 MP4/H.264 走的正是这条被跳过的解码路径 → 黑屏有声。
// WebM/VP9 与本机 X 上能正常播放的视频同路径，可绕开该问题。
//
// 设计：
//   - sidecar 缓存：源 foo.mkv → foo.mkv.webm（同目录）
//     .tmp 中间名带 .tmp 后缀，扫描器会跳过（否则 .webm 会被当成
//     youtube-music 音频重新入库污染曲库）。
//   - 转码完成 rename 到 foo.mkv.webm，之后走正常 Range 流式播放。
//   - 单并发队列：一次只跑一个 ffmpeg，避免把 CPU 打满。
//   - 可查询状态，前端显示"转码中 x%"。

// ============================================================
// MKV → WebM(VP9+Opus) 转码引擎
// ============================================================
// 为什么要转 WebM：本机 Chrome 跳过了 NVIDIA 的 VA-API 硬解设备
// (vaapi_wrapper: "Should skip nVidia device named: nvidia-drm")，
// 而 MP4/H.264 走的正是这条被跳过的解码路径 → 黑屏有声。
// WebM/VP9 与本机 X 上能正常播放的视频同路径，可绕开该问题。
//
// 设计：
//   - sidecar 缓存：源 foo.mkv → 转码写 foo.mkv.webm.tmp（同目录）
//     用 .tmp 后缀是为了让扫描器跳过它（.webm 单独在 AUDIO_EXTS 里，
//     否则会被当成 youtube-music 音频重新入库污染曲库）。
//   - 转码完成 rename 到 foo.mkv.webm，之后走正常 Range 流式播放。
//   - 单并发队列：一次只跑一个 ffmpeg，避免把 CPU 打满。
//   - 可查询状态，前端显示"转码中 x%"。

const TRANSCODE_ENGINE_VERSION = 1;

// 转码状态：queued=排队中, running=转码中, done=完成, error=失败
type TranscodeStatus = 'queued' | 'running' | 'done' | 'error';

interface TranscodeJob {
  srcPath: string;
  outPath?: string; // 探测源编码后确定：AV1/VP9 → .mkv.webm，其余(h264/…) → .mkv.mp4
  tmpPath?: string;
  srcMtime: number;
  srcSize: number;
  status: TranscodeStatus;
  progress: number;
  progressTotal?: number; // 源时长(秒)，用于把 out_time 换算成百分比
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  retries?: number; // 瞬时失败自动重试次数
  waiters: Array<() => void>;
}

// key = 源绝对路径
const transcodeJobs = new Map<string, TranscodeJob>();
let transcodeRunning = 0; // 正在跑的 ffmpeg 数量
const transcodeQueue: string[] = []; // 源绝对路径队列
// remux 是纯 I/O（CPU 几乎为零），可以并发；VP9 转码是 CPU 密集，并发反而拖慢
const TRANCODE_CONCURRENCY = Math.max(1, parseInt(process.env.TRANCODE_CONCURRENCY || '3', 10));

// sidecar 可能是 foo.mkv.webm 或 foo.mkv.mp4，扫描器必须跳过，
// 否则转好的片子会被当成音频/视频重新入库污染曲库。
const MKV_SIDECAR_SUFFIXES = ['.mkv.webm', '.mkv.mp4'];
// 相对源路径的产物后缀（foo.mkv + '.webm' = foo.mkv.webm）
const SIDECAR_OUT_EXTS = ['.webm', '.mp4'];

function isSidecarFile(name: string): boolean {
  return MKV_SIDECAR_SUFFIXES.some((s) => name.endsWith(s));
}

// /api/tracks 排序用的小工具：稳定字符串比较（中文用 Intl.Collator，实例只创建一次；
// localeCompare 每次调用都要重新解析 locale，34k 条排序慢约 8 倍）与确定性 hash
const COLLATOR = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });
function compareString(a: string, b: string): number {
  return COLLATOR.compare(String(a || ''), String(b || ''));
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ================= 查询缓存 =================
// 排序结果缓存（key = sort + seed）：34k 条排序 ~11ms，缓存后同一排序的后续请求
// 只需按筛选条件遍历，不再重复排序。库增删/扫描后失效。
const sortCache = new Map<string, ServerMediaItem[]>();
// 搜索用的小写字段缓存（惰性填充，不写进 db 文件，避免体积膨胀）
const lowerCache = new Map<string, { t: string; a: string }>();

function invalidateQueryCaches(): void {
  sortCache.clear();
  lowerCache.clear();
}

// 返回按 sort 排好的全库数组（引用共享，调用方只读 + filter，不要原地修改）
function getSortedItems(sort: string, seed: number): ServerMediaItem[] {
  const key = `${sort}:${seed || 0}`;
  const hit = sortCache.get(key);
  if (hit) return hit;

  const arr = Array.from(MEDIA_DB.values());
  if (sort === 'random') {
    arr.sort((a, b) => hashString(`${a.id}:${seed}`) - hashString(`${b.id}:${seed}`));
  } else if (sort !== 'default') {
    arr.sort((a, b) => {
      switch (sort) {
        case 'title': return compareString(a.title, b.title);
        case 'artist': return compareString(a.artist, b.artist);
        case 'album': return compareString(a.album, b.album);
        case 'duration': return (a.duration || 0) - (b.duration || 0);
        case 'size': return (a.file_size || 0) - (b.file_size || 0);
        case 'mtime': return (a.mtime || 0) - (b.mtime || 0);
        default: return 0;
      }
    });
  }

  if (sortCache.size >= 12) sortCache.clear(); // 防止 seed 变化导致缓存无限增长
  sortCache.set(key, arr);
  return arr;
}

function lowerFields(item: ServerMediaItem): { t: string; a: string } {
  let v = lowerCache.get(item.id);
  if (!v) {
    v = { t: String(item.title || '').toLowerCase(), a: String(item.artist || '').toLowerCase() };
    lowerCache.set(item.id, v);
  }
  return v;
}

// sidecar 存在性/大小缓存（按源路径）。statSync 在 4T 挂载上约 40µs/次，
// 1233 个 .mkv 就是 ~50ms，列表每次刷新/轮询都付这个代价；缓存后只 stat 一次。
// key = 源 abs_path，srcMtime 变化（源文件被改）时自动失效。
const sidecarStatCache = new Map<string, { outPath: string; size: number; container: string; srcMtime: number }>();

// 已存在且不比源文件旧的 sidecar → 直接复用
function findFreshSidecar(srcPath: string, srcMtime: number): string | undefined {
  for (const ext of SIDECAR_OUT_EXTS) {
    const cand = srcPath + ext;
    try {
      const st = fs.statSync(cand);
      if (st.size > 0 && st.mtimeMs >= srcMtime) return cand;
    } catch { /* 不存在 */ }
  }
  return undefined;
}

// 列表用的转码状态（只读，不触发转码）。
// ready=sidecar 已就绪, running=remux/转码中, queued=排队中, pending=未入队(禁用预转码), error=失败
interface TranscodeInfo {
  status: 'ready' | 'running' | 'queued' | 'pending' | 'error';
  progress: number;
  container?: string; // ready 时产物容器：webm / mp4
  out_size?: number;  // sidecar 大小
}

function transcodeInfo(item: ServerMediaItem): TranscodeInfo | undefined {
  if (item.ext !== '.mkv' || !item.abs_path) return undefined;
  const job = transcodeJobs.get(item.abs_path);
  if (job && job.status !== 'done') {
    return { status: job.status, progress: job.progress };
  }
  const srcMtime = item.mtime ?? 0;
  const cached = sidecarStatCache.get(item.abs_path);
  if (cached && cached.srcMtime === srcMtime) {
    return { status: 'ready', progress: 100, container: cached.container, out_size: cached.size };
  }
  const outPath = (job && job.outPath) || findFreshSidecar(item.abs_path, srcMtime);
  if (outPath) {
    let outSize = 0;
    try { outSize = fs.statSync(outPath).size; } catch {}
    sidecarStatCache.set(item.abs_path, {
      outPath,
      size: outSize,
      container: path.extname(outPath).slice(1),
      srcMtime,
    });
    return { status: 'ready', progress: 100, container: path.extname(outPath).slice(1), out_size: outSize };
  }
  return { status: 'pending', progress: 0 };
}

// 全库 .mkv 转码进度汇总（列表顶部的小统计条）
function transcodeSummary() {
  let total = 0, ready = 0, running = 0, queued = 0, pending = 0, error = 0;
  for (const item of MEDIA_DB.values()) {
    if (item.ext !== '.mkv' || !item.abs_path) continue;
    total++;
    const info = transcodeInfo(item);
    if (!info) continue;
    if (info.status === 'ready') ready++;
    else if (info.status === 'running') running++;
    else if (info.status === 'queued') queued++;
    else if (info.status === 'pending') pending++;
    else error++;
  }
  return { total_mkv: total, ready, running, queued, pending, error };
}

// /api/tracks 的响应里附带转码状态，前端列表直接显示"已转码/转码中/排队"
function decorateItem(item: ServerMediaItem): ServerMediaItem {
  const info = transcodeInfo(item);
  // 歌词状态来自网易云缓存（内存 + fastmusic_lyrics.json）：只读，不触发网络请求。
  // null = 还没查过（用户没播放过这首歌），'no' = 查过但网易云没有歌词。
  const cached = lyricCache.get(lyricCacheKey(item.title, item.artist));
  const lyric: 'yes' | 'no' | null = cached ? (cached.found ? 'yes' : 'no') : null;
  // cover_url 只在封面已经解析/缓存时给出（列表不会因此触发网络请求），
  // 播放器则直接请求 /api/cover/:id，由服务端三级兜底解析。
  const cover_url = coverIndex.has(item.id) ? `/api/cover/${item.id}` : item.cover_url;
  return { ...item, ...(info ? { transcode: info } : {}), cover_url, lyric };
}

// Chrome 的 libwebm demuxer 能解 AV1/VP9（实测本机 headless+真实 Chrome 都出画面，
// 且 seek 正常），所以这两类源只需 **无损 remux**（-c copy，秒级）而不是 VP9 重编码。
// 只有 h264/hevc/mpeg4 这类 webm 不接受的视频编码才走 libvpx-vp9 转码。
const WEBM_NATIVE_CODECS = new Set(['av1', 'vp9']);
// 本机 Chrome 实测能解 H.264 MP4（黑屏结论已推翻），所以 h264 源也只需无损 remux 到 MP4。
const MP4_NATIVE_CODECS = new Set(['h264', 'hevc']);

// 异步探测源的视频/音频编码（不阻塞事件循环）。失败返回 undefined → 走转码兜底。
function probeCodecsAsync(srcPath: string): Promise<{ video?: string; audio?: string } | undefined> {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name',
      '-of', 'csv=p=0',
      srcPath,
    ]);
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000);
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('error', () => { clearTimeout(timer); resolve(undefined); });
    p.on('close', () => {
      clearTimeout(timer);
      let video: string | undefined;
      let audio: string | undefined;
      for (const line of out.split('\n')) {
        const parts = line.split(',').map((s) => s.trim().toLowerCase());
        if (parts.length < 2) continue;
        // ffprobe 字段顺序是 codec_name,codec_type（如 "av1,video"），保险起见两边都认
        const type = parts[0] === 'video' || parts[0] === 'audio' ? parts[0] : parts[1];
        const codec = parts[0] === type ? parts[1] : parts[0];
        if (type === 'video' && !video) video = codec;
        else if (type === 'audio' && !audio) audio = codec;
      }
      if (!video && !audio) resolve(undefined);
      else resolve({ video, audio });
    });
  });
}

function buildFfmpegArgs(
  srcPath: string,
  tmpPath: string,
  codecs: { video?: string; audio?: string } | undefined,
  container: 'webm' | 'mp4',
  remux: boolean
): string[] {
  const base = ['-y', '-hide_banner', '-nostdin', '-i', srcPath];

  if (remux) {
    // 无损 remux：视频/音频流原封不动，只是换容器 → 秒级完成
    const args = [...base, '-map', '0:v:0'];
    if (codecs && codecs.audio) args.push('-map', '0:a:0');
    args.push('-c', 'copy', '-f', container, '-progress', 'pipe:2', '-nostats', tmpPath);
    return args;
  }

  return [
    ...base,
    '-map', '0:v:0', '-map', '0:a:0',
    // deadline good: VP9 离线编码默认 best 极慢(实测 3x 实时), good 快约一倍,
    // crf 33 下画质差异对 MTV 播放几乎不可见
    '-c:v', 'libvpx-vp9', '-deadline', 'good', '-b:v', '0', '-crf', '33', '-row-mt', '1',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus', '-b:a', '128k',
    '-f', 'webm',
    '-progress', 'pipe:2', '-nostats',
    tmpPath,
  ];
}

// 失败处理：瞬时失败（进程被杀 / tmp 被删 / 磁盘抖动）自动重试最多 2 次，
// 避免列表永久显示"转码失败"；连续失败才标记 error。
function markTranscodeError(job: TranscodeJob, msg: string): void {
  job.error = msg;
  job.retries = (job.retries || 0) + 1;
  if (job.retries <= 2) {
    job.status = 'queued';
    job.progress = 0;
    transcodeQueue.push(job.srcPath);
    console.warn(`[Transcode] retry ${job.retries} ${path.basename(job.srcPath)}: ${msg}`);
  } else {
    job.status = 'error';
    console.error(`[Transcode] FAILED ${path.basename(job.srcPath)}: ${msg}`);
  }
  notifyWaiters(job);
  pumpTranscodeQueue();
}

function startTranscode(job: TranscodeJob): void {
  transcodeRunning += 1;
  job.status = 'running';
  job.startedAt = Date.now();

  void probeCodecsAsync(job.srcPath).then((codecs) => {
    const video = codecs?.video;
    // AV1/VP9 → WebM 无损 remux；H.264 → MP4 无损 remux；探测失败/其他 → VP9+Opus WebM 重编码
    const container: 'webm' | 'mp4' | 'vp9' =
      video && WEBM_NATIVE_CODECS.has(video) ? 'webm'
      : video && MP4_NATIVE_CODECS.has(video) ? 'mp4'
      : 'vp9';
    job.outPath = job.srcPath + (container === 'mp4' ? '.mp4' : '.webm');
    job.tmpPath = `${job.srcPath}.fastmusic.tmp`;
    console.log(`[Transcode] start ${path.basename(job.srcPath)} [${container === 'vp9' ? '转码' : 'remux'}→${container === 'vp9' ? 'webm' : container} ${video || '?'}]`);

    const args = buildFfmpegArgs(
      job.srcPath,
      job.tmpPath,
      codecs,
      container === 'vp9' ? 'webm' : container,
      container !== 'vp9'
    );
    const proc = spawn('ffmpeg', args);
    let stderrTail = '';

    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-2000);
      const m = s.match(/out_time_us=(\d+)/) || s.match(/out_time_ms=(\d+)/);
      if (m) {
        const us = parseInt(m[1], 10);
        const sec = us / 1e6;
        if (job.progressTotal && job.progressTotal > 0) {
          job.progress = Math.min(99, Math.round((sec / job.progressTotal) * 100));
        }
      }
    });

    proc.on('error', (err: Error) => {
      try { fs.unlinkSync(job.tmpPath!); } catch {}
      transcodeRunning -= 1;
      markTranscodeError(job, `spawn failed: ${err}`);
    });

    proc.on('close', (code: number | null) => {
      transcodeRunning -= 1;
      if (code === 0) {
        try {
          fs.renameSync(job.tmpPath!, job.outPath!);
          job.status = 'done';
          job.progress = 100;
          job.finishedAt = Date.now();
          // 产出即缓存状态，列表/轮询不再 statSync
          try {
            const st = fs.statSync(job.outPath!);
            sidecarStatCache.set(job.srcPath, {
              outPath: job.outPath!,
              size: st.size,
              container: path.extname(job.outPath!).slice(1),
              srcMtime: job.srcMtime,
            });
          } catch {}
          console.log(`[Transcode] done ${path.basename(job.srcPath)} (${job.finishedAt - (job.startedAt || 0)}ms)`);
        } catch (e: any) {
          try { fs.unlinkSync(job.tmpPath!); } catch {}
          markTranscodeError(job, `rename failed: ${e?.message || e}`);
        }
      } else {
        try { fs.unlinkSync(job.tmpPath!); } catch {}
        markTranscodeError(job, `ffmpeg exit ${code}: ${stderrTail.slice(-400)}`);
      }
      pumpTranscodeQueue();
    });
  });
}

function pumpTranscodeQueue(): void {
  while (transcodeRunning < TRANCODE_CONCURRENCY) {
    const srcPath = transcodeQueue.shift();
    if (!srcPath) return;
    const job = transcodeJobs.get(srcPath);
    if (!job || job.status !== 'queued') continue;
    // 排队期间 sidecar 可能已经产出（例如同一文件被播放请求触发过）→ 直接标记完成
    const fresh = findFreshSidecar(srcPath, job.srcMtime);
    if (fresh) {
      job.outPath = fresh;
      job.status = 'done';
      job.progress = 100;
      notifyWaiters(job);
      continue;
    }
    startTranscode(job);
  }
}

function notifyWaiters(job: TranscodeJob): void {
  for (const w of job.waiters.splice(0)) { try { w(); } catch {} }
}

// 确保 sidecar 存在。返回 job（含状态）。不阻塞调用方。
// 非阻塞版时长探测：返回 Promise，绝不卡住事件循环。
// 只在库里没有 duration（老条目/扫描失败）时才用；否则直接吃现成的。
function probeDurationAsync(filePath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000);
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('error', () => { clearTimeout(timer); resolve(undefined); });
    p.on('close', () => {
      clearTimeout(timer);
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : undefined);
    });
  });
}

function ensureTranscoded(srcPath: string, srcMtime: number, srcSize: number, knownDuration?: number): TranscodeJob {
  const existing = transcodeJobs.get(srcPath);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return existing; // 已在队列/在跑，直接复用
  }
  const fresh = findFreshSidecar(srcPath, srcMtime);
  if (fresh) {
    const done: TranscodeJob = existing && existing.status === 'done' ? existing : {
      srcPath, outPath: fresh, srcMtime, srcSize,
      status: 'done', progress: 100, waiters: [],
    };
    transcodeJobs.set(srcPath, done);
    return done;
  }
  // 新建 job（排队）。outPath 在探测源编码后才确定（.mkv.webm 或 .mkv.mp4）
  const job: TranscodeJob = {
    srcPath, srcMtime, srcSize,
    status: 'queued', progress: 0, waiters: [],
  };
  // 进度分母 = 源时长。优先用扫描时已入库的 duration（零成本）；
  // 只有库里没有时才异步 ffprobe 一次，绝不阻塞事件循环。
  if (Number.isFinite(knownDuration) && (knownDuration as number) > 0) {
    job.progressTotal = knownDuration;
  } else {
    void probeDurationAsync(srcPath).then((n) => {
      if (Number.isFinite(n) && n! > 0 && job.progressTotal === undefined) {
        job.progressTotal = n;
      }
    });
  }
  transcodeJobs.set(srcPath, job);
  transcodeQueue.push(srcPath);
  pumpTranscodeQueue();
  return job;
}

// 轮询直到 sidecar 可用或出错。stream 路由用它做阻塞式等待。
function awaitSidecar(job: TranscodeJob, cb: () => void): void {
  if (job.status === 'done' || job.status === 'error') { cb(); return; }
  job.waiters.push(cb);
}

// 后台预转码：把库里所有尚无侧车的 .mkv 排队（小文件优先，默认 3 并发）。
// 绝大多数 .mkv 是 AV1+Opus，remux 秒级完成，所以队列几分钟就能消化完。
// 目的：MTV 首次播放不再黑屏干等；队列在空闲时逐步消化。
// 关闭：PRETRANCODE_MKV=0。
function queueAllMkvTranscodes(): void {
  if (process.env.PRETRANCODE_MKV === '0') return;
  const pending: Array<{ path: string; mtime: number; size: number; duration?: number }> = [];
  for (const item of MEDIA_DB.values()) {
    if (item.ext !== '.mkv' || !item.abs_path) continue;
    if (!fs.existsSync(item.abs_path)) continue;
    if (findFreshSidecar(item.abs_path, item.mtime ?? 0)) continue;
    pending.push({ path: item.abs_path, mtime: item.mtime ?? 0, size: item.file_size, duration: item.duration });
  }
  if (pending.length === 0) return;
  // 小文件优先：快速出成果，用户点开小 MTV 更快可用
  pending.sort((a, b) => a.size - b.size);
  for (const p of pending) {
    ensureTranscoded(p.path, p.mtime, p.size, p.duration);
  }
  console.log(`[Transcode] 后台预转码队列: ${pending.length} 个 .mkv 排队`);
}

function describeJob(job: TranscodeJob) {
  return {
    status: job.status,
    progress: job.progress,
    error: job.error || null,
    hasProgressTotal: !!job.progressTotal,
  };
}

function loadDbFromDisk(): void {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const items: ServerMediaItem[] = Array.isArray(parsed)
        ? parsed
        : (Array.isArray((parsed as any).items) ? (parsed as any).items : []);
      const dirs: string[] = Array.isArray(parsed)
        ? []
        : ((parsed as any).dirs || []);
      for (const it of items) {
        if (it && it.id) MEDIA_DB.set(it.id, it);
      }
      if (dirs.length > 0) {
        for (const d of dirs) {
          if (!CONFIGURED_DIRS.includes(d)) CONFIGURED_DIRS.push(d);
        }
      }
      console.log(`[DB] 从磁盘加载 ${MEDIA_DB.size} 条目: ${DB_FILE}`);
    }
  } catch (err) {
    console.warn('[DB] 读取本地数据库失败，库为空:', err);
  }
}

function saveDbToDisk(): void {
  try {
    const payload = JSON.stringify({
      dirs: CONFIGURED_DIRS,
      items: Array.from(MEDIA_DB.values()),
    });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, DB_FILE); // atomic
  } catch (err) {
    console.error('[DB] 写入本地数据库失败:', err);
  }
}

// Configured scan directories (supports multiple directories)
// 默认为空: 用环境变量 MEDIA_DIRS="/path/a,/path/b" 预置, 或在「服务器配置」UI / POST /api/directories 添加。
// 已保存的配置会从 fastmusic_db.json 恢复 (见 loadDbFromDisk)。
let CONFIGURED_DIRS: string[] = (process.env.MEDIA_DIRS || '')
  .split(/[,;]/)
  .map((d) => d.trim())
  .filter(Boolean);

function generateId(relativePath: string): string {
  return crypto.createHash('md5').update(relativePath).digest('hex').substring(0, 12);
}

// Find all media files recursively.
// 优先用系统的 fdfind(fd)/find 做枚举：34k 文件只要 ~10s，比 Node 递归 readdirSync 快得多，
// 也更省内存。工具不可用时才退回纯 JS 递归。
function findMediaFilesFast(rootDir: string): Promise<string[]> {
  const exts = [...ALL_MEDIA_EXTS].map((e) => e.slice(1));
  return new Promise((resolve) => {
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn('fdfind', ['-H', '.', '-0', ...exts.flatMap((e) => ['-e', e]), '-t', 'f', rootDir]);
    } catch {
      resolve(findMediaFilesRecursively(rootDir));
      return;
    }
    let buf = '';
    let failed = false;
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 180000);
    p.stdout?.on('data', (d: Buffer) => { buf += d.toString(); });
    p.stderr?.on('data', () => { failed = true; });
    p.on('error', () => { failed = true; });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || buf.length === 0) {
        console.warn(`[Scan] fdfind 不可用，退回 JS 递归枚举 (${code})`);
        resolve(findMediaFilesRecursively(rootDir));
        return;
      }
      const files = buf.split('\0').filter((f) => f && !isSidecarFile(path.basename(f)));
      resolve(files);
    });
  });
}

function findMediaFilesRecursively(dir: string, collected: string[] = []): string[] {
  if (!fs.existsSync(dir)) return collected;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories (like .git, .cache)
        if (!entry.name.startsWith('.')) {
          findMediaFilesRecursively(fullPath, collected);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // 跳过转码引擎产出的 sidecar（foo.mkv.webm），
        // 否则会被当成 youtube-music 音频重新入库污染曲库。
        const isMkvSidecar = isSidecarFile(entry.name);
        if (!isMkvSidecar && ALL_MEDIA_EXTS.has(ext)) {
          collected.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.warn(`[Warn] 读取目录失败 ${dir}:`, err);
  }
  return collected;
}

// ffprobe 兜底：music-metadata 不解析 Matroska 容器，所以 .mkv/.webm 视频拿不到时长。
// 没有时长 → 前端进度条无法计算百分比（分片 MP4 下 Chrome 的 duration 只等于已缓冲片段末尾）。
// 同时用作有效性检查：ffprobe 打不开（ok=false）说明文件损坏（下载不完整 / 不是真媒体）。
// 用 spawn 而非 execFileSync：扫描时每个文件都可能走到这里，同步阻塞会拖垮事件循环。
function probeMediaWithFfprobe(filePath: string): Promise<{ ok: boolean; duration?: number }> {
  return new Promise((resolve) => {
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
    } catch {
      resolve({ ok: false });
      return;
    }
    let out = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000);
    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('error', () => { clearTimeout(timer); resolve({ ok: false }); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const d = parseFloat(out.trim());
      resolve({
        ok: code === 0,
        duration: Number.isFinite(d) && d > 0 ? Math.round(d) : undefined,
      });
    });
  });
}

// Parse media metadata: first attempt ID3/Vorbis tags via music-metadata, then fall back to directory/filename parsing
async function parseMediaFileMetadata(
  filePath: string,
  rootDirectory: string
): Promise<{ title: string; artist: string; album: string; duration?: number; hasTag: boolean; decodable: boolean }> {
  const ext = path.extname(filePath).toLowerCase();
  const rawFileName = path.basename(filePath, ext).trim();
  const relPath = path.relative(rootDirectory, filePath);
  const pathParts = relPath.split(path.sep).filter(p => p.length > 0);

  let title = rawFileName;
  let artist = '未知艺术家';
  let album = '精选集';
  let duration: number | undefined = undefined;
  let hasTag = false;

  // 1. Try reading embedded tags for audio and video if applicable
  if (AUDIO_EXTS.has(ext) || ext === '.mp4') {
    try {
      const metadata = await parseFile(filePath, { duration: true, skipCovers: true });
      if (metadata.common.title && metadata.common.title.trim()) {
        title = metadata.common.title.trim();
        hasTag = true;
      }
      if (metadata.common.artist && metadata.common.artist.trim()) {
        artist = metadata.common.artist.trim();
        hasTag = true;
      }
      if (metadata.common.album && metadata.common.album.trim()) {
        album = metadata.common.album.trim();
        hasTag = true;
      }
      if (metadata.format.duration) {
        duration = Math.round(metadata.format.duration);
      }
    } catch {
      // Ignore metadata parse error and proceed with path heuristics
    }
  }

  // 1b. music-metadata 读不到时长（Matroska 等容器，或标签缺失）→ 用 ffprobe 兜底。
  //     ffprobe 也打不开 → 文件损坏（下载不完整 / 不是真媒体），扫描时剔除。
  let decodable = true;
  if (duration === undefined) {
    const probe = await probeMediaWithFfprobe(filePath);
    duration = probe.duration;
    decodable = probe.ok;
  }

  // 2. If tags didn't provide artist/album or only partial, infer from directory hierarchy
  // Case A: 3-level structure: root / Artist / Album / Title.ext
  if (pathParts.length >= 3) {
    const dirArtist = pathParts[pathParts.length - 3];
    const dirAlbum = pathParts[pathParts.length - 2];
    if (artist === '未知艺术家' || !hasTag) {
      artist = dirArtist;
    }
    if (album === '精选集' || !hasTag) {
      album = dirAlbum;
    }
  } 
  // Case B: 2-level structure: root / Artist Or Album / Title.ext
  else if (pathParts.length === 2) {
    const parentDir = pathParts[0];
    if (album === '精选集' || !hasTag) {
      album = parentDir;
    }
  }

  // 3. Infer from filename patterns like "Artist - Title" or "Title - Artist" (very common in KuGou & YouTube downloads)
  if (artist === '未知艺术家' && rawFileName.includes(' - ')) {
    const splitParts = rawFileName.split(' - ');
    if (splitParts.length === 2) {
      const p1 = splitParts[0].trim();
      const p2 = splitParts[1].trim();
      // Heuristic: usually "Artist - Song" in China (KuGou/QQMusic)
      artist = p1;
      title = p2;
    } else if (splitParts.length > 2) {
      artist = splitParts[0].trim();
      title = splitParts.slice(1).join(' - ').trim();
    }
  }

  return { title, artist, album, duration, hasTag, decodable };
}

// Scans an array of directories, supporting mixed structures and file tags.
// force=false → 增量：已入库且 (mtime,size) 未变更则 skip 重解析（去重）；force=true → 全重扫描
// 元数据解析是扫描的真正瓶颈（music-metadata ~120ms/文件），枚举只要 ~10s。
// 用 worker pool 并发解析（实测 8 并发 ≈ 5x 加速）。关闭并发：SCAN_CONCURRENCY=1。
const SCAN_CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY || '8', 10));

async function scanMultipleLibraries(rootDirs: string[], force: boolean = false) {
  let totalAdded = 0;
  let taggedCount = 0;
  let pathParsedCount = 0;
  let skippedCount = 0;
  let invalidCount = 0;

  for (const rootDir of rootDirs) {
    const trimmed = rootDir.trim();
    if (!trimmed || !fs.existsSync(trimmed)) {
      console.warn(`[Warn] 扫描跳过不存在的目录: ${trimmed}`);
      continue;
    }

    console.log(`[Scan] 正在扫描多媒体目录: ${trimmed}`);
    const files = await findMediaFilesFast(trimmed);
    console.log(`[Scan] 在 ${trimmed} 中发现了 ${files.length} 个媒体文件`);

    const processFile = async (filePath: string): Promise<void> => {
      try {
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mediaType = AUDIO_EXTS.has(ext) ? 'audio' : 'video';
        const relPath = path.relative(trimmed, filePath);
        // Unique ID per path
        const id = generateId(`${trimmed}:${relPath}`);

        // 增量去重：已入库且 (mtime,size) 未变更 → 复用旧条目，skip 重解析
        const existing = MEDIA_DB.get(id);
        if (!force && existing && existing.mtime === stats.mtimeMs && existing.file_size === stats.size) {
          skippedCount++;
          return;
        }

        const parsed = await parseMediaFileMetadata(filePath, trimmed);
        // 损坏文件（ffprobe/music-metadata 都读不出任何信息）→ 不入库，并清理旧条目
        if (!parsed.decodable) {
          console.warn(`[Skip] 文件无法解码（可能下载不完整），不入库: ${filePath}`);
          invalidCount++;
          if (existing) {
            MEDIA_DB.delete(id);
            invalidateQueryCaches();
          }
          return;
        }
        if (parsed.hasTag) taggedCount++;
        else pathParsedCount++;

        MEDIA_DB.set(id, {
          id,
          title: parsed.title,
          artist: parsed.artist,
          album: parsed.album,
          media_type: mediaType,
          ext,
          file_size: stats.size,
          duration: parsed.duration,
          stream_url: `/api/stream/${id}`,
          abs_path: filePath,
          mtime: stats.mtimeMs
        });
        invalidateQueryCaches();
        totalAdded++;
      } catch (err) {
        console.warn(`[Warn] 解析文件失败 ${filePath}:`, err);
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        await processFile(files[cursor++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, worker));
  }

  return {
    total_files: totalAdded,
    tagged_files: taggedCount,
    path_parsed_files: pathParsedCount,
    skipped_files: skippedCount,
    invalid_files: invalidCount
  };
}

// 演示/种子库已删除：不再预加载任何示例媒体
// Recursively scan library folder: root_dir / {Artist} / {Album} / {Title}.{ext}
function scanLibrary(rootDir: string) {
  if (!fs.existsSync(rootDir)) {
    console.warn(`[Warn] 扫描目录不存在: ${rootDir}`);
    return;
  }

  const artists = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const artistDirent of artists) {
    if (!artistDirent.isDirectory()) continue;
    const artistName = artistDirent.name;
    const artistPath = path.join(rootDir, artistName);

    const albums = fs.readdirSync(artistPath, { withFileTypes: true });
    for (const albumDirent of albums) {
      if (!albumDirent.isDirectory()) continue;
      const albumName = albumDirent.name;
      const albumPath = path.join(artistPath, albumName);

      const files = fs.readdirSync(albumPath, { withFileTypes: true });
      for (const fileDirent of files) {
        if (!fileDirent.isFile()) continue;
        const ext = path.extname(fileDirent.name).toLowerCase();
        // MKV 转码产出的侧车文件 (foo.mkv.webm) 不是独立曲目，必须跳过；
        // 否则一次转码就会往库里塞一条重复的音频条目。
        if (isSidecarFile(fileDirent.name)) continue;
        if (!ALL_MEDIA_EXTS.has(ext)) continue;

        const filePath = path.join(albumPath, fileDirent.name);
        const stats = fs.statSync(filePath);
        const title = path.basename(fileDirent.name, ext);
        const relPath = path.relative(rootDir, filePath);
        const id = generateId(relPath);
        const mediaType = AUDIO_EXTS.has(ext) ? 'audio' : 'video';

        MEDIA_DB.set(id, {
          id,
          title,
          artist: artistName,
          album: albumName,
          media_type: mediaType,
          ext,
          file_size: stats.size,
          stream_url: `/api/stream/${id}`,
          abs_path: filePath
        });
        invalidateQueryCaches();
      }
    }
  }
}

// 启动时不再加载任何演示/种子数据，库为空等待真实扫描
// 从磁盘加载持久库（首次启动为空，等待真实扫描）
loadDbFromDisk();
if (CONFIGURED_DIRS.length === 0) {
  console.warn('[Config] 未配置扫描目录。设置环境变量 MEDIA_DIRS="/music,/mtv" 或在「服务器配置」里添加后扫描。');
}
// 启动即排队后台预转码所有 .mkv（单并发、小文件优先），避免 MTV 首播黑屏等待
queueAllMkvTranscodes();

// ================= API 路由 =================

// 0. 获取和配置多目录列表
app.get('/api/directories', (_req: Request, res: Response) => {
  res.json({
    directories: CONFIGURED_DIRS.map(dir => ({
      path: dir,
      exists: fs.existsSync(dir),
    }))
  });
});

app.post('/api/directories', (req: Request, res: Response) => {
  const { directories } = req.body;
  if (Array.isArray(directories)) {
    CONFIGURED_DIRS = directories.map((d: any) => String(d).trim()).filter(Boolean);
  }
  res.json({
    message: '目录配置已更新',
    directories: CONFIGURED_DIRS.map(dir => ({
      path: dir,
      exists: fs.existsSync(dir),
    }))
  });
});

// 1. 重新扫描媒体库 (支持多目录、ID3标签提取、目录层级识别)
app.post('/api/scan', async (req: Request, res: Response) => {
  try {
    // 允许传入单一路径 (path: string) 或多个路径 (paths: string[]) 或空 (使用 CONFIGURED_DIRS)
    let pathsToScan: string[] = [];

    if (req.body && Array.isArray(req.body.paths)) {
      pathsToScan = req.body.paths.filter((p: any) => typeof p === 'string' && p.trim().length > 0);
    } else if (req.body && req.body.path) {
      pathsToScan = [String(req.body.path).trim()];
    } else if (req.query.path) {
      pathsToScan = [String(req.query.path).trim()];
    }

    if (pathsToScan.length === 0) {
      pathsToScan = [...CONFIGURED_DIRS];
    } else {
      // 保持用户添加的路径到配置中
      for (const p of pathsToScan) {
        if (!CONFIGURED_DIRS.includes(p)) {
          CONFIGURED_DIRS.push(p);
        }
      }
    }

    // force=true → 全重扫描（清空+重解析）；否则增量去重（保留已入库未变更）
    const force = (req.body && (req.body.force === true || req.body.force === 'true'))
      || req.query.force === '1' || req.query.force === 'true';

    const validPaths = pathsToScan.filter(p => fs.existsSync(p));

    if (validPaths.length > 0) {
      if (force) {
        MEDIA_DB.clear();
        invalidateQueryCaches();
      }
      const summary = await scanMultipleLibraries(validPaths, force);
      saveDbToDisk();
      // 扫描后新入库的 .mkv 也加入后台预转码队列
      queueAllMkvTranscodes();
      res.json({
        message: `扫描完成：新增 ${summary.total_files}，复用 ${summary.skipped_files}，库共 ${MEDIA_DB.size} 条目`,
        total_tracks: MEDIA_DB.size,
        scanned_paths: validPaths,
        force,
        scan_summary: summary
      });
    } else if (force) {
      // 强制且目录不存在：清空库
      MEDIA_DB.clear();
      invalidateQueryCaches();
      saveDbToDisk();
      res.json({
        message: '强制扫描：指定目录不存在或为空，库已清空。请配置有效的本地媒体目录。',
        total_tracks: 0,
        scanned_paths: pathsToScan,
        force,
        scan_summary: { total_files: 0, tagged_files: 0, path_parsed_files: 0, skipped_files: 0 }
      });
    } else {
      // 增量且目录不存在：保留已入库库，不清空
      res.json({
        message: `指定目录不存在或为空，保留已入库 ${MEDIA_DB.size} 条目（增量不清空）。请配置有效的本地媒体目录。`,
        total_tracks: MEDIA_DB.size,
        scanned_paths: pathsToScan,
        force,
        scan_summary: { total_files: 0, tagged_files: 0, path_parsed_files: 0, skipped_files: 0 }
      });
    }
  } catch (err: any) {
    console.error('[Scan Error]', err);
    res.status(500).json({ detail: `扫描过程发生错误: ${err.message}` });
  }
});

// 2. 获取所有歌手 / UP主
app.get('/api/artists', (_req: Request, res: Response) => {
  const artistsMap = new Map<string, { albums: Set<string>; tracks: number; coverId?: string }>();

  for (const item of MEDIA_DB.values()) {
    if (!artistsMap.has(item.artist)) {
      artistsMap.set(item.artist, { albums: new Set(), tracks: 0 });
    }
    const info = artistsMap.get(item.artist)!;
    info.albums.add(item.album);
    info.tracks += 1;
    // 头像取该歌手第一个"封面已缓存"的曲目（只读缓存，不触发网络解析）
    if (!info.coverId && coverIndex.has(item.id)) info.coverId = item.id;
  }

  const result = Array.from(artistsMap.entries()).map(([artist_name, data]) => ({
    artist_name,
    album_count: data.albums.size,
    track_count: data.tracks,
    avatar_url: data.coverId ? `/api/cover/${data.coverId}` : undefined
  }));

  res.json(result);
});

// 3. 获取专辑列表
app.get('/api/albums', (req: Request, res: Response) => {
  const artistFilter = req.query.artist as string | undefined;
  const albumsMap = new Map<string, { artist_name: string; album_name: string; track_count: number; coverId?: string }>();

  for (const item of MEDIA_DB.values()) {
    if (artistFilter && item.artist !== artistFilter) continue;
    const key = `${item.artist}___${item.album}`;
    if (!albumsMap.has(key)) {
      albumsMap.set(key, {
        artist_name: item.artist,
        album_name: item.album,
        track_count: 0,
        coverId: coverIndex.has(item.id) ? item.id : undefined,
      });
    }
    const info = albumsMap.get(key)!;
    info.track_count += 1;
    if (!info.coverId && coverIndex.has(item.id)) info.coverId = item.id;
  }

  res.json(
    Array.from(albumsMap.values()).map((d) => ({
      artist_name: d.artist_name,
      album_name: d.album_name,
      track_count: d.track_count,
      cover_url: d.coverId ? `/api/cover/${d.coverId}` : undefined
    }))
  );
});

// 4. 查询媒体曲目 (支持模糊搜索、类型过滤与 limit / offset 分页)
app.get('/api/tracks', (req: Request, res: Response) => {
  const artist = req.query.artist as string | undefined;
  const album = req.query.album as string | undefined;
  const media_type = req.query.media_type as string | undefined;
  const search = (req.query.search as string | undefined)?.toLowerCase();
  // ready_only=1: 只返回"立刻可播"的条目（非 .mkv，或 .mkv 的 sidecar 已就绪）
  const readyOnly = req.query.ready_only === '1' || req.query.ready_only === 'true';
  // sort: title | artist | album | duration | size | mtime | random（默认 = 索引顺序）
  const sort = (req.query.sort as string | undefined) || 'default';
  const seed = parseInt(req.query.seed as string, 10) || 0;

  // limit / offset 分页参数
  const limitQuery = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : undefined;
  const offsetQuery = req.query.offset !== undefined ? parseInt(req.query.offset as string, 10) : undefined;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const page_size = req.query.page_size ? parseInt(req.query.page_size as string, 10) : 50;

  // 排序结果缓存（按 sort+seed），筛选只是遍历已排好的数组，顺序保持不变
  const base = getSortedItems(sort, seed);
  const results: ServerMediaItem[] = [];

  for (const item of base) {
    if (artist && item.artist !== artist) continue;
    if (album && item.album !== album) continue;
    if (media_type && item.media_type !== media_type) continue;
    if (search) {
      const lc = lowerFields(item);
      if (!lc.t.includes(search) && !lc.a.includes(search)) continue;
    }
    if (readyOnly) {
      const info = transcodeInfo(item);
      if (info && info.status !== 'ready') continue;
    }
    results.push(item);
  }

  const total = results.length;

  // 1. 如果使用了 limit / offset
  if (limitQuery !== undefined || offsetQuery !== undefined) {
    const limit = Math.min(200, Math.max(1, limitQuery || 30));
    const offset = Math.max(0, offsetQuery || 0);
    const items = results.slice(offset, offset + limit).map(decorateItem);
    const has_more = offset + limit < total;

    res.json({
      items,
      total,
      limit,
      offset,
      has_more
    });
    return;
  }

  // 2. 如果使用了 page / page_size
  if (page) {
    const total_pages = Math.max(1, Math.ceil(total / page_size));
    const start = (page - 1) * page_size;
    const items = results.slice(start, start + page_size).map(decorateItem);

    res.json({
      items,
      total,
      page,
      page_size,
      total_pages,
      has_more: start + page_size < total
    });
    return;
  }

  // 兼容直接请求数组或全量包
  res.json({
    items: results,
    total,
    limit: total,
    offset: 0,
    has_more: false
  });
});

// 4.1 随心电台模式：获取随机混洗曲目并即时播放
app.get('/api/radio', (req: Request, res: Response) => {
  const media_type = req.query.media_type as string | undefined;
  const count = Math.min(100, Math.max(1, parseInt((req.query.count as string) || '50', 10)));

  let candidates = Array.from(MEDIA_DB.values());
  if (media_type && (media_type === 'audio' || media_type === 'video')) {
    candidates = candidates.filter(t => t.media_type === media_type);
  }

  if (candidates.length === 0) {
    res.json({ items: [], total: 0, channel: media_type || 'all' });
    return;
  }

  // Fisher-Yates 洗牌算法
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, count);
  res.json({
    items: selected,
    total: candidates.length,
    channel: media_type || 'all'
  });
});

// 5. 获取单个媒体详情
app.get('/api/tracks/:id', (req: Request, res: Response) => {
  const item = MEDIA_DB.get(req.params.id);
  if (!item) {
    res.status(404).json({ detail: '未找到该媒体文件' });
    return;
  }
  res.json(item);
});

// 5.5 转码状态查询：前端据此显示"转码中 x% / 排队 / 失败"
// 说明：.mkv 走转码引擎（本机 Chrome 跳过 VA-API 硬解 → MP4 黑屏有声，故统一转 WebM）。
// 已转好的文件走 stream 的常规路径，此接口只报告排队/进度/失败。
// 6.0a 全库 .mkv 转码进度汇总（列表顶部统计条）
app.get('/api/transcode/summary', (req: Request, res: Response) => {
  res.json(transcodeSummary());
});

// 6.0b 批量查询转码状态（列表轮询，只读，不触发转码）
app.get('/api/transcode/status', (req: Request, res: Response) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
  const items: Array<{ id: string; transcode: TranscodeInfo | null }> = [];
  for (const id of ids) {
    const item = MEDIA_DB.get(id);
    items.push({ id, transcode: item ? transcodeInfo(item) ?? null : null });
  }
  res.json({ items });
});

app.get('/api/transcode/:id', (req: Request, res: Response) => {
  const item = MEDIA_DB.get(req.params.id);
  if (!item) {
    res.status(404).json({ detail: '未找到该媒体文件' });
    return;
  }
  if (item.ext !== '.mkv' || !item.abs_path) {
    res.json({ status: 'done', progress: 100, error: null, ext: item.ext });
    return;
  }
  const st = fs.statSync(item.abs_path);
  const job = ensureTranscoded(item.abs_path, st.mtimeMs, st.size, item.duration);
  res.json({ ...describeJob(job), ext: item.ext });
});

// 6. 流式播放 (支持 HTTP 206 Range 范围请求断点续传与平滑寻道)
// 统一的 Range 流式响应。stream 路由的常规路径与转码完成后的回调都用它。
function serveFileWithRange(
  res: Response,
  filePath: string,
  mimeType: string,
  rangeHeader?: string,
): void {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      // 防止 Chrome 缓存旧响应(如修复前缓存的 mkv 全文件 → 转码后仍黑屏)
      'Cache-Control': 'no-store',
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

app.get('/api/stream/:id', (req: Request, res: Response) => {
  const item = MEDIA_DB.get(req.params.id);
  if (!item) {
    res.status(404).json({ detail: '媒体文件不存在' });
    return;
  }

  const absPath = item.abs_path;
  if (!absPath) {
    res.status(404).json({ detail: '未配置流媒体源路径' });
    return;
  }

  // If remote URL, redirect or stream directly
  if (absPath.startsWith('http://') || absPath.startsWith('https://')) {
    res.redirect(absPath);
    return;
  }

  // MKV → 走转码引擎。源与 sidecar 同目录：foo.mkv → foo.mkv.webm
  // 本机 Chrome 跳过 NVIDIA VA-API 硬解，MP4/H.264 会黑屏有声，
  // 所以统一转 WebM(VP9+Opus)，走 Chrome 能正常渲染的路径。
  let servePath = absPath;
  if (item.ext === '.mkv') {
    const st = fs.statSync(absPath);
    const job = ensureTranscoded(absPath, st.mtimeMs, st.size, item.duration);

    if (job.status === 'done') {
      servePath = job.outPath!;
    } else if (job.status === 'error') {
      res.status(500).json({ detail: `转码失败: ${job.error || '未知错误'}` });
      return;
    } else {
      // 排队/转码中：等它完成即播（不需要客户端轮询）
      const waitMs = parseInt(String(req.query.wait || '600000'), 10) || 600000;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        res.status(504).json({ detail: '转码超时', progress: job.progress });
      }, waitMs);

      res.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); } });

      awaitSidecar(job, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (job.status === 'done') {
          const outExt = path.extname(job.outPath!).toLowerCase();
          serveFileWithRange(res, job.outPath!, outExt === '.mp4' ? 'video/mp4' : 'video/webm', req.headers.range);
        } else {
          res.status(500).json({ detail: `转码失败: ${job.error || '未知错误'}` });
        }
      });
      return;
    }
  }

  if (!fs.existsSync(servePath)) {
    res.status(404).json({ detail: '本地物理文件已丢失' });
    return;
  }

  const ext = path.extname(servePath).toLowerCase();
  let mimeType = 'application/octet-stream';
  if (ext === '.webm') mimeType = 'video/webm';
  else if (ext === '.mkv') mimeType = 'video/x-matroska';
  else if (ext === '.mp4') mimeType = 'video/mp4';
  else if (ext === '.flac') mimeType = 'audio/flac';
  else if (ext === '.mp3') mimeType = 'audio/mpeg';
  else if (ext === '.ogg' || ext === '.opus') mimeType = 'audio/ogg';

  serveFileWithRange(res, servePath, mimeType, req.headers.range);
});

// ============================================================
// 歌词：网易云明文接口（不需要 weapi/AES 加密）
//   搜索: https://music.163.com/api/search/get?s=...&type=1
//   歌词: https://music.163.com/api/song/lyric?id=<id>&lv=1&tv=1&rv=1
// 匹配策略：本地 title+artist 搜索 → 按标题/歌手/时长打分选最佳候选 →
// 取 lrc（原歌词），tlyric（翻译）可选。结果缓存（内存 + fastmusic_lyrics.json）。
// ============================================================
const NCM_HEADERS = {
  // 裸接口不加密，但缺 UA/Referer 容易被风控返回空 body
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Accept: 'application/json, text/plain, */*',
};

interface LyricResult {
  found: boolean;
  ncm_id?: number;
  matched_title?: string;
  matched_artist?: string;
  lyric: string;
  tlyric: string;
  romalrc: string;
  fetched_at: number;
}

const LYRIC_CACHE_MAX = 800;
const lyricCache = new Map<string, LyricResult>();
const LYRIC_DB_FILE = path.join(__dirname, 'fastmusic_lyrics.json');

function lyricCacheKey(title: string, artist: string): string {
  return `${normalizeText(title)}|${normalizeText(artist)}`;
}

function loadLyricCache(): void {
  try {
    if (!fs.existsSync(LYRIC_DB_FILE)) return;
    const data = JSON.parse(fs.readFileSync(LYRIC_DB_FILE, 'utf8')) as Record<string, LyricResult>;
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v.lyric === 'string') lyricCache.set(k, v);
    }
    console.log(`[Lyrics] 已加载歌词缓存 ${lyricCache.size} 条`);
  } catch (e) {
    console.warn('[Lyrics] 歌词缓存读取失败', (e as Error).message);
  }
}

// 原子写（tmp + rename），失败只告警不影响播放
function saveLyricCache(): void {
  try {
    const entries: Record<string, LyricResult> = {};
    for (const [k, v] of lyricCache) entries[k] = v;
    const tmp = `${LYRIC_DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, LYRIC_DB_FILE);
  } catch (e) {
    console.warn('[Lyrics] 歌词缓存写入失败', (e as Error).message);
  }
}

function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

async function ncmFetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const res = await fetch(url, {
    headers: NCM_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`网易云接口 HTTP ${res.status}`);
  const text = await res.text();
  if (!text) throw new Error('网易云返回空响应');
  return JSON.parse(text);
}

// 网易云搜索（type=1 = 歌曲）
async function searchNeteaseSongs(query: string, limit = 10): Promise<any[]> {
  const url = `https://music.163.com/api/search/get?v=1&type=1&limit=${limit}&s=${encodeURIComponent(query)}`;
  const data = await ncmFetchJson(url);
  const list = data?.result?.songs;
  return Array.isArray(list) ? list : [];
}

async function fetchNeteaseLyric(id: number): Promise<LyricResult | null> {
  const data = await ncmFetchJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1&rv=1`);
  const lyric = (data?.lrc?.lyric || '').trim();
  if (!lyric) return null;
  return {
    found: true,
    ncm_id: id,
    matched_title: '',
    lyric,
    tlyric: (data?.tlyric?.lyric || '').trim(),
    romalrc: (data?.romalrc?.lyric || '').trim(),
    fetched_at: Date.now(),
  };
}

// 打分：标题完全匹配 > 包含匹配；歌手匹配加分；时长接近加分
function scoreCandidate(cand: any, title: string, artist: string, duration: number): number {
  const qTitle = normalizeText(title);
  const cTitle = normalizeText(cand?.name || '');
  let score = 0;
  if (!cTitle) return -1;
  if (cTitle === qTitle) score += 100;
  else if (cTitle.includes(qTitle) || qTitle.includes(cTitle)) score += 60;
  else return -1;

  const cArtist = normalizeText((cand?.artists || []).map((a: any) => a?.name || '').join(''));
  const qArtist = normalizeText(artist);
  if (qArtist && cArtist) {
    if (cArtist === qArtist) score += 40;
    else if (cArtist.includes(qArtist) || qArtist.includes(cArtist)) score += 25;
  }
  if (duration && cand?.duration) {
    // 搜索接口返回 duration 单位是毫秒
    const candDur = cand.duration / 1000;
    const diff = Math.abs(candDur - duration);
    if (diff <= 3) score += 20;
    else if (diff <= 10) score += 10;
    else if (diff > 30) score -= 15;
  }
  return score;
}

// 8. 歌词：?title=&artist=&duration= 自动搜索匹配；?id= 直接取网易云歌曲 ID
app.get('/api/lyrics', async (req: Request, res: Response) => {
  const title = (req.query.title as string | undefined) || '';
  const artist = (req.query.artist as string | undefined) || '';
  const duration = Number(req.query.duration) || 0;
  const directId = Number(req.query.id) || 0;

  if (!title && !directId) {
    res.status(400).json({ found: false, detail: '缺少 title 或 id 参数' });
    return;
  }

  const key = directId ? `id:${directId}` : lyricCacheKey(title, artist);
  const cached = lyricCache.get(key);
  if (cached) {
    res.json({ ...cached, cached: true });
    return;
  }

  try {
    // 候选来源：先 "标题 歌手"，若无匹配再只搜标题（网易云搜索对原唱/翻唱排序不稳定）
    const queries = directId
      ? []
      : [artist ? `${title} ${artist}` : title, ...(artist && title ? [title] : [])];
    const candidates: any[] = [];
    const seen = new Set<number>();
    for (const q of queries) {
      for (const cand of await searchNeteaseSongs(q, 10)) {
        if (cand?.id && !seen.has(cand.id)) {
          seen.add(cand.id);
          candidates.push(cand);
        }
      }
    }
    if (directId) candidates.push({ id: directId, name: title, artists: [{ name: artist }] });

    let result: LyricResult | null = null;
    for (const cand of candidates) {
      if (!cand?.id) continue;
      if (!directId && scoreCandidate(cand, title, artist, duration) < 60) continue;
      const lyric = await fetchNeteaseLyric(cand.id);
      if (lyric) {
        lyric.matched_title = cand.name || title;
        lyric.matched_artist = (cand.artists || []).map((a: any) => a?.name || '').join(', ') || artist;
        result = lyric;
        break;
      }
    }

    if (!result) {
      // 负结果也缓存，避免每次切歌都重复打网络
      const miss: LyricResult = { found: false, lyric: '', tlyric: '', romalrc: '', fetched_at: Date.now() };
      lyricCache.set(key, miss);
      res.json({ ...miss, cached: false });
      return;
    }

    if (lyricCache.size >= LYRIC_CACHE_MAX) lyricCache.delete(lyricCache.keys().next().value as string);
    lyricCache.set(key, result);
    saveLyricCache();
    res.json({ ...result, cached: false });
  } catch (e) {
    console.warn('[Lyrics] 获取歌词失败', (e as Error).message);
    res.status(502).json({ found: false, detail: '获取歌词失败（网易云不可达或被风控）' });
  }
});

// ============================================================
// 9. 封面引擎：三级兜底
//   1) 本地内嵌封面（ID3 APIC / Vorbis Picture）→ 零网络、毫秒级
//   2) iTunes Search API（免 key、免注册、全球曲库；artworkUrl100 → 600x600bb）
//   3) 网易云搜索 API（与歌词同源；picUrl?param=500y500 让 CDN 裁尺寸省带宽）
// 图片字节缓存到 covers/<id>.<ext>，索引持久化到 fastmusic_covers.json。
// "查过但没有封面" 也记录（coverMisses），避免每次切歌都重新联网。
// ============================================================
const COVER_DIR = path.join(__dirname, 'covers');
const COVER_INDEX_FILE = path.join(__dirname, 'fastmusic_covers.json');
const COVER_MAX_BYTES = 3 * 1024 * 1024;
const COVER_PREFETCH_MAX = 200;
const COVER_PREFETCH_CONCURRENCY = 8;

interface CoverEntry {
  source: 'local' | 'itunes' | 'netease';
  ext: string;        // '.jpg' | '.png' | '.webp'
  url?: string;       // 远端原始 URL（调试用）
  matched?: string;   // 匹配到的远端曲目
  fetched_at: number;
}

const coverIndex = new Map<string, CoverEntry>();
const coverMisses = new Set<string>();
const coverInFlight = new Map<string, Promise<CoverEntry | null>>();

function coverFile(id: string, ext: string): string {
  return path.join(COVER_DIR, `${id}${ext}`);
}

function imageMime(ext: string): string {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function loadCoverIndex(): void {
  try {
    if (!fs.existsSync(COVER_INDEX_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(COVER_INDEX_FILE, 'utf8'));
    // 新格式 { covers: {...}, misses: [...] }；旧格式（纯对象）也兼容
    const covers: Record<string, CoverEntry> = raw && raw.covers ? raw.covers : raw;
    for (const [id, v] of Object.entries(covers || {})) {
      // 缓存文件被手动删掉时丢弃条目，下次重新解析
      if (v && v.ext && fs.existsSync(coverFile(id, v.ext))) coverIndex.set(id, v);
    }
    if (Array.isArray(raw?.misses)) for (const id of raw.misses) coverMisses.add(String(id));
    console.log(`[Cover] 已加载封面缓存 ${coverIndex.size} 条（无封面 ${coverMisses.size} 条）`);
  } catch (e) {
    console.warn('[Cover] 封面索引读取失败', (e as Error).message);
  }
}

// 原子写（tmp + rename），失败只告警不影响播放。
// 索引可能有几万条，所以写盘是防抖的：最多每 5 秒一次。
let coverSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCoverSave(): void {
  if (coverSaveTimer) return;
  coverSaveTimer = setTimeout(() => {
    coverSaveTimer = null;
    saveCoverIndex();
  }, 5000);
}

function saveCoverIndex(): void {
  try {
    const entries: Record<string, CoverEntry> = {};
    for (const [k, v] of coverIndex) entries[k] = v;
    const payload = { covers: entries, misses: Array.from(coverMisses) };
    const tmp = `${COVER_INDEX_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, COVER_INDEX_FILE);
  } catch (e) {
    console.warn('[Cover] 封面索引写入失败', (e as Error).message);
  }
}

async function fetchImageBuffer(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<{ data: Buffer; ext: string } | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200 || buf.length > COVER_MAX_BYTES) return null;
    const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
    return { data: buf, ext };
  } catch {
    return null;
  }
}

// 1) 本地内嵌封面：扫描时用 skipCovers: true 跳过，这里按需二次解析
async function extractEmbeddedCover(item: ServerMediaItem): Promise<{ data: Buffer; ext: string } | null> {
  if (!item.abs_path) return null;
  try {
    const meta = await parseFile(item.abs_path, { duration: false, skipCovers: false });
    const pic = meta.common.picture?.[0];
    if (!pic || !pic.data || pic.data.length === 0) return null;
    const fmt = (pic.format || 'image/jpeg').toLowerCase();
    const ext = fmt.includes('png') ? '.png' : fmt.includes('webp') ? '.webp' : '.jpg';
    return { data: Buffer.from(pic.data), ext };
  } catch {
    return null;
  }
}

interface CoverCandidate {
  source: 'itunes' | 'netease';
  url: string;
  matched: string;
  score: number;
}

// 歌手字段常见噪声：YouTube 官方频道 / Topic / Vevo 后缀，去掉后再比较，
// 否则 "乃木坂46 OFFICIAL YouTube CHANNEL" 与 "乃木坂46" 会被判成不符。
function artistTokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/(official|youtube|channel|topic|vevo)/g, ' ')
    .split(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff]+/)
    .filter((t) => t.length >= 2);
}

// 翻唱/歌ってみた 这类二次创作，封面不是原曲的封面，扣分
const COVER_MARKER_RE = /翻唱|歌みた|カバー|cover/i;

// 打分：标题精确 100 / 包含 60（否则淘汰）；歌手一致 +40、部分匹配 +25、不符 -40
// （翻唱/DJ 版很常见，歌手不符要重扣）；专辑一致 +15；网易云时长接近 +20/+10
function scoreCoverMatch(
  qTitle: string,
  qArtist: string,
  qAlbum: string,
  cTitle: string,
  cArtist: string,
  cAlbum: string,
  candDurationMs?: number,
  localDuration?: number
): number {
  if (!cTitle) return -1;
  let score = 0;
  if (cTitle === qTitle) score += 100;
  else if (cTitle.includes(qTitle) || qTitle.includes(cTitle)) score += 60;
  else return -1;

  if (COVER_MARKER_RE.test(cTitle)) score -= 30;

  const qTokens = artistTokens(qArtist);
  const cTokens = artistTokens(cArtist);
  if (qTokens.length && cTokens.length) {
    let best = -40;
    for (const a of qTokens) {
      for (const b of cTokens) {
        if (a === b) {
          best = 40;
          break;
        }
        if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
          best = Math.max(best, 25);
        }
      }
      if (best === 40) break;
    }
    score += best;
  }
  if (qAlbum && cAlbum && (cAlbum === qAlbum || cAlbum.includes(qAlbum) || qAlbum.includes(cAlbum))) {
    score += 15;
  }
  if (localDuration && candDurationMs) {
    const diff = Math.abs(candDurationMs / 1000 - localDuration);
    if (diff <= 3) score += 20;
    else if (diff <= 10) score += 10;
    else if (diff > 30) score -= 10;
  }
  return score;
}

// 2) iTunes Search API：公开、免 key。白嫖 Apple CDN 的超清大图：100x100bb → 600x600bb
async function itunesCandidates(
  title: string,
  artist: string,
  album: string
): Promise<CoverCandidate[]> {
  const term = [title, artist].filter(Boolean).join(' ');
  if (!term) return [];
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FastMusic/1.0)' },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const qTitle = normalizeText(title);
    const qArtist = normalizeText(artist);
    const qAlbum = normalizeText(album);
    const out: CoverCandidate[] = [];
    for (const r of results) {
      const score = scoreCoverMatch(
        qTitle,
        qArtist,
        qAlbum,
        normalizeText(r?.trackName || ''),
        normalizeText(r?.artistName || ''),
        normalizeText(r?.collectionName || '')
      );
      if (score < 65) continue;
      const art = String(r?.artworkUrl100 || '').replace('100x100bb', '600x600bb');
      if (!art) continue;
      out.push({
        source: 'itunes',
        url: art,
        matched: `${r.trackName || ''} - ${r.artistName || ''}`.trim(),
        score,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// 网易云搜索结果里的 album 对象没有 picUrl（只有 picId），需要再查一次专辑详情。
// 专辑 pic 按 album id 缓存，同一专辑的多首歌只联网一次。
const neteaseAlbumPicCache = new Map<number, string | null>();

async function neteaseAlbumPic(albumId: number): Promise<string | null> {
  if (neteaseAlbumPicCache.has(albumId)) return neteaseAlbumPicCache.get(albumId) ?? null;
  let pic: string | null = null;
  try {
    const data = await ncmFetchJson(`https://music.163.com/api/v1/album/${albumId}`);
    pic = data?.album?.picUrl || data?.songs?.[0]?.al?.picUrl || null;
  } catch {
    pic = null;
  }
  neteaseAlbumPicCache.set(albumId, pic);
  return pic;
}

// 3) 网易云搜索：复用歌词的明文接口。网易云 CDN 支持 ?param=WxH 裁尺寸，省带宽
async function neteaseCandidates(
  title: string,
  artist: string,
  album: string,
  duration: number
): Promise<CoverCandidate[]> {
  const queries = [artist ? `${title} ${artist}` : title, ...(artist && title ? [title] : [])];
  const seen = new Set<number>();
  const scored: Array<{ cand: any; score: number }> = [];
  for (const q of queries) {
    let songs: any[] = [];
    try {
      songs = await searchNeteaseSongs(q, 8);
    } catch {
      continue;
    }
    for (const cand of songs) {
      if (!cand?.id || seen.has(cand.id)) continue;
      seen.add(cand.id);
      const score = scoreCoverMatch(
        normalizeText(title),
        normalizeText(artist),
        normalizeText(album),
        normalizeText(cand.name || ''),
        normalizeText((cand.artists || []).map((a: any) => a?.name || '').join('')),
        normalizeText(cand.album?.name || ''),
        cand.duration,
        duration
      );
      if (score < 65) continue;
      scored.push({ cand, score });
    }
    // 第一个查询已经够多了，不必再联网查第二个
    if (scored.length >= 3) break;
  }
  scored.sort((a, b) => b.score - a.score);

  const out: CoverCandidate[] = [];
  // 专辑图片要再查一次详情，所以只取分数最高的 3 个候选
  for (const { cand, score } of scored.slice(0, 3)) {
    const pic =
      cand.album?.picUrl || (cand.album?.id ? await neteaseAlbumPic(Number(cand.album.id)) : null);
    if (!pic) continue;
    out.push({
      source: 'netease',
      url: `${pic}?param=500y500`,
      matched: `${cand.name || title} - ${(cand.artists || []).map((a: any) => a?.name || '').join(', ') || artist}`,
      score,
    });
  }
  return out;
}

// 解析顺序：磁盘缓存 → 本地内嵌 → iTunes → 网易云。allowRemote=false 时不联网。
async function resolveCover(item: ServerMediaItem, allowRemote: boolean): Promise<CoverEntry | null> {
  const hit = coverIndex.get(item.id);
  if (hit) return hit;
  if (coverMisses.has(item.id)) return null;

  // 同一曲目并发请求（列表 + 播放器同时请求）只解析一次
  const inflight = coverInFlight.get(item.id);
  if (inflight) return inflight;

  const task = (async (): Promise<CoverEntry | null> => {
    const embedded = await extractEmbeddedCover(item);
    if (embedded) {
      try {
        fs.mkdirSync(COVER_DIR, { recursive: true });
        fs.writeFileSync(coverFile(item.id, embedded.ext), embedded.data);
        const entry: CoverEntry = { source: 'local', ext: embedded.ext, matched: '内嵌封面', fetched_at: Date.now() };
        coverIndex.set(item.id, entry);
        scheduleCoverSave();
        return entry;
      } catch (e) {
        console.warn('[Cover] 内嵌封面写入失败', (e as Error).message);
      }
    }

    if (allowRemote) {
      // 两个源并发查询，按打分选最佳候选（标题/歌手/专辑/时长），逐个尝试下载直到成功
      const pool = (
        await Promise.all([
          itunesCandidates(item.title, item.artist, item.album || ''),
          neteaseCandidates(item.title, item.artist, item.album || '', item.duration || 0),
        ])
      )
        .flat()
        .sort((a, b) => b.score - a.score);

      for (const cand of pool) {
        const img = await fetchImageBuffer(cand.url, {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        if (!img) continue;
        try {
          fs.mkdirSync(COVER_DIR, { recursive: true });
          fs.writeFileSync(coverFile(item.id, img.ext), img.data);
          const entry: CoverEntry = {
            source: cand.source,
            ext: img.ext,
            url: cand.url,
            matched: cand.matched,
            fetched_at: Date.now(),
          };
          coverIndex.set(item.id, entry);
          scheduleCoverSave();
          return entry;
        } catch (e) {
          console.warn('[Cover] 远端封面写入失败', (e as Error).message);
        }
      }
    }

    coverMisses.add(item.id);
    scheduleCoverSave();
    return null;
  })();

  coverInFlight.set(item.id, task);
  try {
    return await task;
  } finally {
    coverInFlight.delete(item.id);
  }
}

// GET /api/cover/:id → 图片字节（?local=1 只读本地内嵌，不联网）
app.get('/api/cover/:id', async (req: Request, res: Response) => {
  const item = MEDIA_DB.get(req.params.id);
  if (!item) {
    res.status(404).json({ detail: '曲目不存在' });
    return;
  }
  try {
    const entry = await resolveCover(item, req.query.local !== '1');
    if (!entry) {
      res.status(404).json({ detail: '未找到封面' });
      return;
    }
    const file = coverFile(item.id, entry.ext);
    if (!fs.existsSync(file)) {
      coverIndex.delete(item.id);
      res.status(404).json({ detail: '封面缓存文件丢失' });
      return;
    }
    res.set('Content-Type', imageMime(entry.ext));
    res.set('Cache-Control', 'public, max-age=31536000');
    res.set('X-Cover-Source', entry.source);
    res.sendFile(file);
  } catch (e) {
    console.warn('[Cover] 封面请求失败', (e as Error).message);
    res.status(500).json({ detail: '封面获取失败' });
  }
});

// POST /api/cover/prefetch { ids: [...] } → 批量解析（并发 8，最多 200 条），
// 返回 id → cover_url（null = 没有封面）。列表的"预取封面"按钮走这里。
app.post('/api/cover/prefetch', async (req: Request, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String) : [];
  const limited: string[] = ids.slice(0, COVER_PREFETCH_MAX);
  const covers: Record<string, string | null> = {};

  const queue = limited.filter((id) => !coverIndex.has(id) && !coverMisses.has(id));
  const workers = Array.from(
    { length: Math.min(COVER_PREFETCH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        const item = MEDIA_DB.get(id);
        if (!item) {
          covers[id] = null;
          continue;
        }
        const entry = await resolveCover(item, true);
        covers[id] = entry ? `/api/cover/${id}` : null;
      }
    }
  );
  await Promise.all(workers);

  for (const id of limited) {
    if (!(id in covers)) covers[id] = coverIndex.has(id) ? `/api/cover/${id}` : null;
  }

  const resolved = Object.values(covers).filter(Boolean).length;
  res.json({
    requested: limited.length,
    resolved,
    cached: coverIndex.size,
    covers,
  });
});

// 7. 健康检查
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'Express Media Server', total_tracks: MEDIA_DB.size });
});

// ================= Vite / 静态文件托管 =================
async function startServer() {
  loadLyricCache(); // 歌词缓存（网易云）持久化，重启后不重复请求
  loadCoverIndex(); // 封面缓存（covers/ + fastmusic_covers.json）

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Express Media Server] 运行在 http://0.0.0.0:${PORT}`);
  });
}

startServer();
