import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  Trash2,
  Folder,
  Image,
  Users,
  Disc3,
  FileText,
  Clock,
  Pause,
  Play
} from 'lucide-react';
import { mediaApi } from '../services/api';
import { ScanResponse } from '../types/media';
import { CacheJob, CacheJobKind, CacheStats } from '../types/media';
import { SCROLLBAR_CLASSES } from '../utils/ui';

interface SystemConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
}

// 4 个全库缓存任务（服务端后台执行，进度轮询 GET /api/cache/status）
const CACHE_TASKS: Array<{
  kind: CacheJobKind;
  title: string;
  hint: string;
  icon: typeof Image;
  totalKey: 'tracks' | 'artists' | 'albums';
}> = [
  {
    kind: 'track_covers',
    title: '缓存全部歌曲 / MTV 封面',
    hint: '本地内嵌 → iTunes → 网易云，图片存 covers/',
    icon: Image,
    totalKey: 'tracks'
  },
  {
    kind: 'artist_covers',
    title: '缓存全部歌手封面',
    hint: '每个歌手取一条代表曲目解析头像',
    icon: Users,
    totalKey: 'artists'
  },
  {
    kind: 'album_covers',
    title: '缓存全部专辑封面',
    hint: '每个专辑取一条代表曲目解析封面',
    icon: Disc3,
    totalKey: 'albums'
  },
  {
    kind: 'track_lyrics',
    title: '缓存全部歌曲 / MTV 歌词',
    hint: '网易云搜索匹配，LRC 存 lyrics/（同标题+歌手只联网一次）',
    icon: FileText,
    totalKey: 'tracks'
  }
];

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return '—';
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

export const SystemConfigModal: React.FC<SystemConfigModalProps> = ({
  isOpen,
  onClose,
  onRefreshData
}) => {
  const [baseUrl, setBaseUrl] = useState<string>(mediaApi.getBaseUrl());

  // Multiple scan directories list (空列表 = 尚未配置, 打开弹窗时从服务端读取)
  const [directories, setDirectories] = useState<string[]>([]);
  const [newDirPath, setNewDirPath] = useState<string>('');

  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; trackCount?: number } | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // 全库缓存任务状态
  const [jobs, setJobs] = useState<CacheJob[]>([]);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  // 任务从"运行中"变成"结束"时刷新列表（封面/歌词 badge 需要重新拉取）
  const runningRef = useRef<Set<CacheJobKind>>(new Set());
  const refreshRef = useRef(onRefreshData);
  refreshRef.current = onRefreshData;

  // Load configured directories on mount or open
  useEffect(() => {
    if (!isOpen) return;
    mediaApi.getDirectories().then(dirs => {
      if (dirs && dirs.length > 0) {
        setDirectories(dirs.map(d => d.path));
      }
    }).catch(() => {});
  }, [isOpen]);

  // 轮询缓存任务进度（2s），任务结束时刷新媒体库
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const poll = async () => {
      const status = await mediaApi.getCacheStatus();
      if (cancelled) return;
      setJobs(status.jobs);
      if (status.stats) setStats(status.stats);

      for (const job of status.jobs) {
        if (job.running) {
          runningRef.current.add(job.kind);
        } else if (runningRef.current.has(job.kind)) {
          runningRef.current.delete(job.kind);
          refreshRef.current();
        }
      }
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveAndTest = async () => {
    mediaApi.setBaseUrl(baseUrl);
    setIsTesting(true);
    setTestResult(null);

    const res = await mediaApi.testConnection();
    setTestResult(res);
    setIsTesting(false);
    if (res.ok) {
      onRefreshData();
    }
  };

  const handleAddDirectory = () => {
    const trimmed = newDirPath.trim();
    if (!trimmed) return;
    if (directories.includes(trimmed)) return;
    const updated = [...directories, trimmed];
    setDirectories(updated);
    setNewDirPath('');
    mediaApi.updateDirectories(updated);
  };

  const handleRemoveDirectory = (dirToRemove: string) => {
    const updated = directories.filter(d => d !== dirToRemove);
    setDirectories(updated);
    mediaApi.updateDirectories(updated);
  };

  const handleScanAll = async () => {
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await mediaApi.scanLibrary(directories);
      setScanResult(res);
      onRefreshData();
    } catch (err: any) {
      setScanError(err.message || '扫描请求失败，请检查后端运行状态');
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanSingle = async (dirPath: string) => {
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await mediaApi.scanLibrary([dirPath]);
      setScanResult(res);
      onRefreshData();
    } catch (err: any) {
      setScanError(err.message || '扫描单目录失败');
    } finally {
      setIsScanning(false);
    }
  };

  const jobFor = (kind: CacheJobKind): CacheJob | undefined => jobs.find(j => j.kind === kind);

  const handleRunJob = async (kind: CacheJobKind) => {
    setCacheError(null);
    const job = await mediaApi.runCacheJob(kind);
    if (!job) {
      setCacheError('缓存任务启动失败，请检查后端运行状态');
      return;
    }
    setJobs(prev => prev.map(j => (j.kind === kind ? job : j)));
  };

  const handleStopJob = async (kind: CacheJobKind) => {
    const job = await mediaApi.stopCacheJob(kind);
    if (job) setJobs(prev => prev.map(j => (j.kind === kind ? job : j)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-100 text-sm sm:text-base">
                系统配置
              </h3>
              <p className="text-[11px] text-neutral-400">
                全库封面与歌词缓存 · 扫描目录 · 服务端连接
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className={`p-6 space-y-6 overflow-y-auto text-xs text-neutral-300 ${SCROLLBAR_CLASSES}`}>
          {/* 全库缓存任务 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-neutral-200 flex items-center gap-1.5">
                <Disc3 className="w-4 h-4 text-rose-400" />
                <span>全库缓存任务</span>
              </label>
              {stats && (
                <span className="text-[11px] text-neutral-500">
                  曲目 {fmtNum(stats.tracks)} · 歌手 {fmtNum(stats.artists)} · 专辑 {fmtNum(stats.albums)} ·
                  封面 {fmtNum(stats.covers_cached)} · 歌词 {fmtNum(stats.lyric_hits)}
                </span>
              )}
            </div>

            <p className="text-[11px] text-neutral-500 mb-3 leading-relaxed">
              任务在服务器后台运行，关闭弹窗不会中断；结果持久化到
              <code className="text-neutral-300"> covers/</code> 与
              <code className="text-neutral-300"> lyrics/</code>，中断后再次启动会自动跳过已缓存的条目。
              全库首次缓存需要较长时间（网易云 / iTunes 有限流，任务会自动节流）。
            </p>

            <div className="space-y-2.5">
              {CACHE_TASKS.map((task) => {
                const Icon = task.icon;
                const job = jobFor(task.kind);
                const total = job?.total ?? (stats ? stats[task.totalKey] : 0);
                const done = job?.done ?? 0;
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

                return (
                  <div
                    key={task.kind}
                    className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80 hover:border-neutral-700 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-neutral-200">{task.title}</div>
                          <div className="text-[11px] text-neutral-500">{task.hint}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {job?.running ? (
                          <button
                            onClick={() => handleStopJob(task.kind)}
                            className="px-3 py-1.5 text-[11px] bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/50 rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>停止</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRunJob(task.kind)}
                            disabled={total === 0}
                            className="px-3 py-1.5 text-[11px] bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>{job && job.remaining === 0 ? '重新检查' : '开始缓存'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${job?.running ? 'bg-gradient-to-r from-rose-500 to-amber-400' : 'bg-emerald-500/70'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                      <span>
                        已处理 <span className="font-mono text-neutral-300">{fmtNum(done)} / {fmtNum(total)}</span>
                      </span>
                      <span>
                        命中 <span className="font-mono text-emerald-300">{fmtNum(job?.hits ?? 0)}</span>
                      </span>
                      <span>
                        无结果 <span className="font-mono text-neutral-400">{fmtNum(job?.misses ?? 0)}</span>
                      </span>
                      {job?.errors ? (
                        <span>
                          错误 <span className="font-mono text-rose-300">{fmtNum(job.errors)}</span>
                        </span>
                      ) : null}
                      {job?.running ? (
                        <span className="text-amber-300 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          剩余 {fmtNum(job.remaining)} 条 · 约 {fmtDuration(job.etaSeconds)}
                        </span>
                      ) : job?.remaining ? (
                        <span className="text-amber-400">已停止 · 剩余 {fmtNum(job.remaining)} 条</span>
                      ) : job?.finishedAt ? (
                        <span className="text-emerald-400">已完成</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {cacheError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{cacheError}</span>
              </div>
            )}
          </div>

          {/* Service Base URL & Test */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-200">服务端连接配置</span>
              <span className="text-[11px] text-neutral-400">运行环境: Express + CORS</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="留空为同源直连 (推荐) 或输入自定义地址如 http://localhost:3000"
                className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-200 font-mono text-xs focus:outline-none focus:border-rose-500"
              />
              <button
                onClick={handleSaveAndTest}
                disabled={isTesting}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-rose-400" />
                )}
                <span>测试连接</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
                  testResult.ok
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800 text-rose-300'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Multi-Directory Management */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-neutral-200 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-amber-400" />
                <span>扫描根目录列表（可添加任意多个不同存储盘/路径）</span>
              </label>
              <span className="text-[11px] text-neutral-500">已配置 {directories.length} 个路径</span>
            </div>

            {/* List of directories */}
            <div className="space-y-2 mb-3">
              {directories.map((dir, idx) => (
                <div
                  key={idx}
                  className="group flex items-center justify-between p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl hover:border-neutral-700 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <Folder className="w-4 h-4 text-neutral-500 group-hover:text-amber-400 transition-colors shrink-0" />
                    <span className="font-mono text-xs text-neutral-200 truncate select-all">{dir}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleScanSingle(dir)}
                      disabled={isScanning}
                      title="只扫描此目录"
                      className="px-2.5 py-1 text-[11px] bg-neutral-900 hover:bg-neutral-800 text-neutral-300 rounded-lg border border-neutral-800 transition-colors"
                    >
                      单独扫描
                    </button>
                    <button
                      onClick={() => handleRemoveDirectory(dir)}
                      title="移除此目录"
                      className="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-neutral-900 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add new directory input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newDirPath}
                onChange={(e) => setNewDirPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddDirectory();
                }}
                placeholder="输入绝对路径，例如 /home/you/Music 或 D:/Music"
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 font-mono text-xs focus:outline-none focus:border-rose-500"
              />
              <button
                onClick={handleAddDirectory}
                disabled={!newDirPath.trim()}
                className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                <span>添加路径</span>
              </button>
            </div>

            {/* Trigger Scan Button */}
            <div className="pt-3">
              <button
                onClick={handleScanAll}
                disabled={isScanning || directories.length === 0}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-rose-900/20"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>正在扫描各目录多媒体文件与标签元数据...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>重新扫描所有已配置目录 (POST /api/scan)</span>
                  </>
                )}
              </button>

              {/* Scan Result Feedback */}
              {scanResult && (
                <div className="mt-3 p-3.5 rounded-xl bg-neutral-950 border border-emerald-800/60 text-neutral-200 space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{scanResult.message}</span>
                  </div>
                  {scanResult.scan_summary && (
                    <div className="text-[11px] text-neutral-400 grid grid-cols-3 gap-2 pt-1 border-t border-neutral-900">
                      <div>已收录文件: <span className="text-neutral-200 font-mono">{scanResult.scan_summary.total_files}</span></div>
                      <div>带内置标签: <span className="text-emerald-300 font-mono">{scanResult.scan_summary.tagged_files}</span></div>
                      <div>目录/文件名解析: <span className="text-amber-300 font-mono">{scanResult.scan_summary.path_parsed_files}</span></div>
                    </div>
                  )}
                </div>
              )}

              {scanError && (
                <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{scanError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Architecture & Scanning Strategy Info Card */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5">
            <div className="flex items-center gap-2 text-rose-400 font-medium">
              <AlertCircle className="w-4 h-4" />
              <span>扫描与缓存策略说明</span>
            </div>
            <div className="text-[11px] text-neutral-400 leading-relaxed space-y-1.5">
              <p>
                针对您不同的目录存放情况（如 <code className="text-neutral-300">KuGou/flac</code> 与 <code className="text-neutral-300">youtube</code>、<code className="text-neutral-300">youtube-music</code>）：
              </p>
              <ul className="list-disc pl-4 space-y-1 text-neutral-400">
                <li>
                  <strong className="text-neutral-200">无缝多目录支持</strong>：后端支持维护多个扫描根目录，无论歌曲分布在不同分区还是子文件夹，均可一次性扫描合并索引。
                </li>
                <li>
                  <strong className="text-neutral-200">内置标签优先提取 (music-metadata)</strong>：针对 FLAC/MP3/MP4 等文件，优先读取其内部的 ID3/Vorbis/MP4 元数据标签（标题、歌手、专辑、时长）。
                </li>
                <li>
                  <strong className="text-neutral-200">智能目录与文件名回退</strong>：对于 YouTube 下载或酷狗批量下载等无内置标签的文件，系统自动识别标准分层结构（<code className="text-neutral-300">歌手/专辑/歌曲</code>），并支持从形如 <code className="text-neutral-300">歌手 - 歌名</code> 的文件名中解析出歌手与曲名，专辑自动归类，不会出现混乱或识别失败。
                </li>
                <li>
                  <strong className="text-neutral-200">增量扫描</strong>：已索引且 (修改时间, 大小) 未变化的文件会被跳过，只有新增或改动的文件才重新解析元数据。
                </li>
                <li>
                  <strong className="text-neutral-200">封面 / 歌词缓存</strong>：封面三级兜底（本地内嵌 → iTunes → 网易云）存 <code className="text-neutral-300">covers/</code>；歌词来自网易云明文接口，存 <code className="text-neutral-300">lyrics/</code>，索引在 <code className="text-neutral-300">fastmusic_covers.json</code> / <code className="text-neutral-300">fastmusic_lyrics.json</code>。
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-neutral-800 bg-neutral-900/90 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium transition-colors"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
