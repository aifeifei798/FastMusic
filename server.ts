import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { parseFile } from 'music-metadata';
import { execFileSync, spawn } from 'child_process';

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
}

// In-Memory Database Map: key is media_id
const MEDIA_DB = new Map<string, ServerMediaItem>();

// 持久本地数据库：扫描一次写到磁盘，重启 不再 清空；增量去重 skip 已入库未变更文件
const DB_FILE = path.join(__dirname, 'fastmusic_db.json');

// 本地媒体流服务端。核心难点：本机 Chrome 跳过 NVIDIA 的 VA-API 硬解设备，
// MP4/H.264 走的正是这条被跳过的解码路径 → 黑屏有声。
// 因此所有 .mkv 统一经下方的转码引擎转成 WebM(VP9+Opus) 侧车文件再流式播放。
// ============================================================
// MKV → WebM(VP9+Opus) 转码引擎
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
  outPath: string;
  tmpPath: string;
  srcMtime: number;
  srcSize: number;
  status: TranscodeStatus;
  progress: number;
  progressTotal?: number; // 源时长(秒)，用于把 out_time 换算成百分比
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  waiters: Array<() => void>;
}

const transcodeJobs = new Map<string, TranscodeJob>();
let transcodeRunning = false;
const transcodeQueue: string[] = [];

// sidecar 以 .webm 结尾（ext='.webm'，且 .webm 在 AUDIO_EXTS 里），
// 扫描器必须据此跳过，否则转好的片子会被当成音频入库。
const MKV_SIDECAR_SUFFIX = '.mkv.webm';

function sidecarPaths(srcPath: string): { outPath: string; tmpPath: string } {
  return { outPath: `${srcPath}.webm`, tmpPath: `${srcPath}.fastmusic.tmp` };
}

function isSidecarFresh(outPath: string, srcMtime: number, srcSize: number): boolean {
  try {
    const st = fs.statSync(outPath);
    if (st.size === 0) return false;
    if (st.mtimeMs < srcMtime) return false;
    return true;
  } catch { return false; }
}

function buildFfmpegArgs(srcPath: string, tmpPath: string): string[] {
  return [
    '-y', '-hide_banner', '-nostdin',
    '-i', srcPath,
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

function pumpTranscodeQueue(): void {
  if (transcodeRunning) return;
  const outPath = transcodeQueue.shift();
  if (!outPath) return;
  const job = transcodeJobs.get(outPath);
  if (!job || job.status !== 'queued') { pumpTranscodeQueue(); return; }

  transcodeRunning = true;
  job.status = 'running';
  job.startedAt = Date.now();
  console.log(`[Transcode] start ${path.basename(job.srcPath)}`);

  const args = buildFfmpegArgs(job.srcPath, job.tmpPath);
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
    job.status = 'error';
    job.error = `spawn failed: ${err}`;
    try { fs.unlinkSync(job.tmpPath); } catch {}
    transcodeRunning = false;
    notifyWaiters(job);
    pumpTranscodeQueue();
  });

  proc.on('close', (code: number | null) => {
    transcodeRunning = false;
    if (code === 0) {
      try {
        fs.renameSync(job.tmpPath, job.outPath);
        job.status = 'done';
        job.progress = 100;
        job.finishedAt = Date.now();
        console.log(`[Transcode] done ${path.basename(job.srcPath)} (${job.finishedAt - (job.startedAt||0)}ms)`);
      } catch (e: any) {
        job.status = 'error';
        job.error = `rename failed: ${e?.message || e}`;
        try { fs.unlinkSync(job.tmpPath); } catch {}
      }
    } else {
      job.status = 'error';
      job.error = `ffmpeg exit ${code}: ${stderrTail.slice(-400)}`;
      try { fs.unlinkSync(job.tmpPath); } catch {}
      console.error(`[Transcode] FAILED ${path.basename(job.srcPath)}: ${job.error}`);
    }
    notifyWaiters(job);
    pumpTranscodeQueue();
  });
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
  const { outPath, tmpPath } = sidecarPaths(srcPath);
  const existing = transcodeJobs.get(outPath);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return existing; // 已在队列/在跑，直接复用
  }
  if (isSidecarFresh(outPath, srcMtime, srcSize)) {
    const done: TranscodeJob = existing && existing.status === 'done' ? existing : {
      srcPath, outPath, tmpPath, srcMtime, srcSize,
      status: 'done', progress: 100, waiters: [],
    };
    transcodeJobs.set(outPath, done);
    return done;
  }
  // 新建 job（排队）
  const job: TranscodeJob = {
    srcPath, outPath, tmpPath, srcMtime, srcSize,
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
  transcodeJobs.set(outPath, job);
  transcodeQueue.push(outPath);
  pumpTranscodeQueue();
  return job;
}

// 轮询直到 sidecar 可用或出错。stream 路由用它做阻塞式等待。
function awaitSidecar(job: TranscodeJob, cb: () => void): void {
  if (job.status === 'done' || job.status === 'error') { cb(); return; }
  job.waiters.push(cb);
}

// 后台预转码：把库里所有尚无侧车的 .mkv 排队转 WebM（小文件优先，单并发）。
// 目的：MTV 首次播放不再黑屏干等几分钟；队列在空闲时逐步消化。
// 关闭：PRETRANCODE_MKV=0。
function queueAllMkvTranscodes(): void {
  if (process.env.PRETRANCODE_MKV === '0') return;
  const pending: Array<{ path: string; mtime: number; size: number; duration?: number }> = [];
  for (const item of MEDIA_DB.values()) {
    if (item.ext !== '.mkv' || !item.abs_path) continue;
    if (!fs.existsSync(item.abs_path)) continue;
    if (isSidecarFresh(sidecarPaths(item.abs_path).outPath, item.mtime ?? 0, item.file_size)) continue;
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
let CONFIGURED_DIRS: string[] = [
  '/home/feifei/mnt/data_4t/KuGou/flac',
  '/home/feifei/mnt/data_4t/youtube',
  '/home/feifei/mnt/data_4t/youtube-music'
];

function generateId(relativePath: string): string {
  return crypto.createHash('md5').update(relativePath).digest('hex').substring(0, 12);
}

// Find all media files recursively
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
        const isMkvSidecar = entry.name.endsWith(MKV_SIDECAR_SUFFIX);
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
function probeMediaWithFfprobe(filePath: string): { ok: boolean; duration?: number } {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15000 }
    ).toString().trim();
    const d = parseFloat(out);
    return { ok: true, duration: Number.isFinite(d) && d > 0 ? Math.round(d) : undefined };
  } catch (err) {
    console.warn(`[Warn] ffprobe 时长探测失败 ${filePath}:`, err);
    return { ok: false };
  }
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
    const probe = probeMediaWithFfprobe(filePath);
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
    const files = findMediaFilesRecursively(trimmed);
    console.log(`[Scan] 在 ${trimmed} 中发现了 ${files.length} 个媒体文件`);

    for (const filePath of files) {
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
          continue;
        }

        const parsed = await parseMediaFileMetadata(filePath, trimmed);
        // 损坏文件（ffprobe/music-metadata 都读不出任何信息）→ 不入库，并清理旧条目
        if (!parsed.decodable) {
          console.warn(`[Skip] 文件无法解码（可能下载不完整），不入库: ${filePath}`);
          invalidCount++;
          if (existing) MEDIA_DB.delete(id);
          continue;
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
        totalAdded++;
      } catch (err) {
        console.warn(`[Warn] 解析文件失败 ${filePath}:`, err);
      }
    }
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
        if (fileDirent.name.endsWith(MKV_SIDECAR_SUFFIX)) continue;
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
      }
    }
  }
}

// 启动时不再加载任何演示/种子数据，库为空等待真实扫描
// 从磁盘加载持久库（首次启动为空，等待真实扫描）
loadDbFromDisk();
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
      if (force) MEDIA_DB.clear();
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
  const artistsMap = new Map<string, { albums: Set<string>; tracks: number; cover_url?: string }>();

  for (const item of MEDIA_DB.values()) {
    if (!artistsMap.has(item.artist)) {
      artistsMap.set(item.artist, { albums: new Set(), tracks: 0 });
    }
    const info = artistsMap.get(item.artist)!;
    info.albums.add(item.album);
    info.tracks += 1;
    // 头像取该歌手第一个带封面曲目的 cover_url（聚合时顺手记录，避免 O(N^2) 二次查找）
    if (!info.cover_url && item.cover_url) info.cover_url = item.cover_url;
  }

  const result = Array.from(artistsMap.entries()).map(([artist_name, data]) => ({
    artist_name,
    album_count: data.albums.size,
    track_count: data.tracks,
    avatar_url: data.cover_url
  }));

  res.json(result);
});

// 3. 获取专辑列表
app.get('/api/albums', (req: Request, res: Response) => {
  const artistFilter = req.query.artist as string | undefined;
  const albumsMap = new Map<string, { artist_name: string; album_name: string; track_count: number; cover_url?: string }>();

  for (const item of MEDIA_DB.values()) {
    if (artistFilter && item.artist !== artistFilter) continue;
    const key = `${item.artist}___${item.album}`;
    if (!albumsMap.has(key)) {
      albumsMap.set(key, {
        artist_name: item.artist,
        album_name: item.album,
        track_count: 0,
        cover_url: item.cover_url
      });
    }
    albumsMap.get(key)!.track_count += 1;
  }

  res.json(Array.from(albumsMap.values()));
});

// 4. 查询媒体曲目 (支持模糊搜索、类型过滤与 limit / offset 分页)
app.get('/api/tracks', (req: Request, res: Response) => {
  const artist = req.query.artist as string | undefined;
  const album = req.query.album as string | undefined;
  const media_type = req.query.media_type as string | undefined;
  const search = (req.query.search as string | undefined)?.toLowerCase();
  
  // limit / offset 分页参数
  const limitQuery = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : undefined;
  const offsetQuery = req.query.offset !== undefined ? parseInt(req.query.offset as string, 10) : undefined;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const page_size = req.query.page_size ? parseInt(req.query.page_size as string, 10) : 50;

  const results: ServerMediaItem[] = [];

  for (const item of MEDIA_DB.values()) {
    if (artist && item.artist !== artist) continue;
    if (album && item.album !== album) continue;
    if (media_type && item.media_type !== media_type) continue;
    if (search && !item.title.toLowerCase().includes(search) && !item.artist.toLowerCase().includes(search)) {
      continue;
    }
    results.push(item);
  }

  const total = results.length;

  // 1. 如果使用了 limit / offset
  if (limitQuery !== undefined || offsetQuery !== undefined) {
    const limit = Math.min(200, Math.max(1, limitQuery || 30));
    const offset = Math.max(0, offsetQuery || 0);
    const items = results.slice(offset, offset + limit);
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
    const items = results.slice(start, start + page_size);

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
      servePath = job.outPath;
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
          serveFileWithRange(res, job.outPath, 'video/webm', req.headers.range);
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

// 7. 健康检查
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'Express Media Server', total_tracks: MEDIA_DB.size });
});

// ================= Vite / 静态文件托管 =================
async function startServer() {
  loadLyricCache(); // 歌词缓存（网易云）持久化，重启后不重复请求

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
