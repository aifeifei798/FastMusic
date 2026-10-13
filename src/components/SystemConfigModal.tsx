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
  Play,
  Film,
  Loader2
} from 'lucide-react';
import { mediaApi } from '../services/api';
import { t, tServerMessage } from '../utils/i18n';
import { ScanResponse } from '../types/media';
import { CacheJob, CacheJobKind, CacheStats, TranscodeSummary } from '../types/media';
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
  if (sec < 60) return t('{n} 秒', { n: Math.round(sec) });
  const min = Math.round(sec / 60);
  if (min < 60) return t('{n} 分钟', { n: min });
  return t('{h} 小时 {m} 分', { h: Math.floor(min / 60), m: min % 60 });
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

  // .mkv 转码（remux）队列汇总 —— 全库统计只在这里展示，列表工具栏不再显示
  const [transcode, setTranscode] = useState<TranscodeSummary | null>(null);

  // 断点续播开关：默认关闭，只有用户显式开启后才记录/恢复播放位置
  const [resumeEnabled, setResumeEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fastmusic_resume_enabled') === '1';
    } catch {
      return false;
    }
  });

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

  // 轮询 .mkv 转码汇总（5s）：后台队列在 server 启动时自动排队，这里只是只读展示
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const poll = async () => {
      const summary = await mediaApi.getTranscodeSummary();
      if (!cancelled && summary) setTranscode(summary);
    };
    poll();
    const timer = setInterval(poll, 5000);
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

  const handleToggleResume = () => {
    const next = !resumeEnabled;
    setResumeEnabled(next);
    try {
      localStorage.setItem('fastmusic_resume_enabled', next ? '1' : '0');
    } catch {
      // localStorage 不可用时仍保持当前弹窗内的状态
    }
    window.dispatchEvent(new CustomEvent('fastmusic:resume-enabled-change', { detail: { enabled: next } }));
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
      setScanError(err.message || t('扫描请求失败，请检查后端运行状态'));
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
      setScanError(err.message || t('扫描单目录失败'));
    } finally {
      setIsScanning(false);
    }
  };

  const jobFor = (kind: CacheJobKind): CacheJob | undefined => jobs.find(j => j.kind === kind);

  const handleRunJob = async (kind: CacheJobKind) => {
    setCacheError(null);
    const job = await mediaApi.runCacheJob(kind);
    if (!job) {
      setCacheError(t('缓存任务启动失败，请检查后端运行状态'));
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
      <div className="w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-ink text-sm sm:text-base">
                {t('系统配置')}
              </h3>
              <p className="text-[11px] text-muted">
                {t('全库缓存任务 · 转码队列 · 扫描目录 · 服务端连接')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className={`p-6 space-y-6 overflow-y-auto text-xs text-ink-3 ${SCROLLBAR_CLASSES}`}>
          {/* 全库缓存任务 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-ink-2 flex items-center gap-1.5">
                <Disc3 className="w-4 h-4 text-accent" />
                <span>{t('全库缓存任务')}</span>
              </label>
              {stats && (
                <span className="text-[11px] text-muted-2">
                  {t('曲目 {n}', { n: fmtNum(stats.tracks) })} · {t('歌手 {n}', { n: fmtNum(stats.artists) })} · {t('专辑 {n}', { n: fmtNum(stats.albums) })} ·
                  {t('封面 {n}', { n: fmtNum(stats.covers_cached) })} · {t('歌词 {n}', { n: fmtNum(stats.lyric_hits) })}
                </span>
              )}
            </div>

            <p className="text-[11px] text-muted-2 mb-3 leading-relaxed">
              {t('任务在服务器后台运行，关闭弹窗不会中断；结果持久化到')}
              <code className="text-ink-3"> covers/</code> {t('与')}
              <code className="text-ink-3"> lyrics/</code>{t('，中断后再次启动会自动跳过已缓存的条目。')}
              {t('全库首次缓存需要较长时间（网易云 / iTunes 有限流，任务会自动节流）。')}
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
                    className="p-3.5 rounded-xl bg-app border border-line/80 hover:border-line-strong transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-ink-2">{t(task.title)}</div>
                          <div className="text-[11px] text-muted-2">{t(task.hint)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {job?.running ? (
                          <button
                            onClick={() => handleStopJob(task.kind)}
                            className="px-3 py-1.5 text-[11px] bg-amber/20 hover:bg-amber/30 text-amber border border-amber-dim/50 rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>{t('停止')}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRunJob(task.kind)}
                            disabled={total === 0}
                            className="px-3 py-1.5 text-[11px] bg-accent hover:bg-accent disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>{job && job.remaining === 0 ? t('重新检查') : t('开始缓存')}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${job?.running ? 'bg-gradient-to-r from-accent to-amber' : 'bg-emerald/70'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-2">
                      <span>
                        {t('已处理')} <span className="font-mono text-ink-3">{fmtNum(done)} / {fmtNum(total)}</span>
                      </span>
                      <span>
                        {t('命中')} <span className="font-mono text-emerald">{fmtNum(job?.hits ?? 0)}</span>
                      </span>
                      <span>
                        {t('无结果')} <span className="font-mono text-muted">{fmtNum(job?.misses ?? 0)}</span>
                      </span>
                      {job?.errors ? (
                        <span>
                          {t('错误')} <span className="font-mono text-accent-soft">{fmtNum(job.errors)}</span>
                        </span>
                      ) : null}
                      {job?.running ? (
                        <span className="text-amber flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {t('剩余 {n} 条 · 约 {eta}', { n: fmtNum(job.remaining), eta: fmtDuration(job.etaSeconds) })}
                        </span>
                      ) : job?.remaining ? (
                        <span className="text-amber">{t('已停止 · 剩余 {n} 条', { n: fmtNum(job.remaining) })}</span>
                      ) : job?.finishedAt ? (
                        <span className="text-emerald">{t('已完成')}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {cacheError && (
              <div className="mt-3 p-3 rounded-xl bg-accent-dim/40 border border-accent-dim text-accent-soft flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-accent" />
                <span>{cacheError}</span>
              </div>
            )}
          </div>

          {/* 断点续播开关：默认关闭，开启后才记录/恢复播放位置 */}
          <div className="p-4 rounded-xl bg-app border border-line/80 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium text-ink-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber" />
                  <span>{t('断点续播')}</span>
                </span>
                <p className="text-[11px] text-muted-2 leading-relaxed">
                  {t('记住收听歌曲的时间，重新打开同一曲目继续播放。默认关闭。')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={resumeEnabled}
                onClick={handleToggleResume}
                className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 shrink-0 ${
                  resumeEnabled
                    ? 'bg-emerald/20 border-emerald-dim/50 text-emerald hover:bg-emerald/30'
                    : 'bg-surface-2 border-line text-muted-2 hover:text-ink hover:bg-elevated'
                }`}
              >
                <span>{resumeEnabled ? t('开启') : t('关闭')}</span>
              </button>
            </div>
          </div>

          {/* .mkv 转码（remux）队列状态：全库统计收进这里，列表工具栏不再显示 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-ink-2 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-amber" />
                <span>{t('转码 / Remux 状态')}</span>
              </label>
              {transcode && (
                <span className="text-[11px] text-muted-2">
                  {t('.mkv 总数 {n}', { n: fmtNum(transcode.total_mkv) })}
                </span>
              )}
            </div>

            <p className="text-[11px] text-muted-2 mb-3 leading-relaxed">
              {t('Chrome 不能直接播放 .mkv，服务端把每个 .mkv 无损换容器成 sidecar（AV1/VP9 → WebM，H.264/HEVC → MP4），写在源文件旁边；sidecar 比源文件新就不再重复转码。')}
              {t('启动时自动排队全库转码（并发 ')}
              <code className="text-ink-3">TRANCODE_CONCURRENCY</code>
              {t('，默认 3），')}
              <code className="text-ink-3">PRETRANCODE_MKV=0</code>
              {t(' 可关闭。')}
            </p>

            {transcode && transcode.total_mkv > 0 ? (
              <div className="p-3.5 rounded-xl bg-app border border-line/80">
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald"
                    style={{
                      width: `${Math.min(100, Math.round((transcode.ready / transcode.total_mkv) * 100))}%`
                    }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-2">
                  <span className="flex items-center gap-1 text-emerald">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('已就绪')}
                    <span className="font-mono text-ink-3">{fmtNum(transcode.ready)} / {fmtNum(transcode.total_mkv)}</span>
                  </span>
                  {transcode.running > 0 && (
                    <span className="flex items-center gap-1 text-amber">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t('转码中')}
                      <span className="font-mono text-amber">{fmtNum(transcode.running)}</span>
                    </span>
                  )}
                  {(transcode.queued > 0 || transcode.pending > 0) && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {t('排队')}
                      <span className="font-mono">{fmtNum(transcode.queued + transcode.pending)}</span>
                    </span>
                  )}
                  {transcode.error > 0 && (
                    <span className="flex items-center gap-1 text-accent-soft">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t('失败')}
                      <span className="font-mono">{fmtNum(transcode.error)}</span>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-2">{t('没有 .mkv 文件，无需转码。')}</p>
            )}
          </div>

          {/* Service Base URL & Test */}
          <div className="p-4 rounded-xl bg-app border border-line/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink-2">{t('服务端连接配置')}</span>
              <span className="text-[11px] text-muted">{t('运行环境: Express + CORS')}</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('留空为同源直连 (推荐) 或输入自定义地址如 http://localhost:3000')}
                className="flex-1 px-3 py-2 bg-surface border border-line rounded-xl text-ink-2 font-mono text-xs focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleSaveAndTest}
                disabled={isTesting}
                className="px-4 py-2 bg-surface-2 hover:bg-elevated text-ink-2 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                )}
                <span>{t('测试连接')}</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
                  testResult.ok
                    ? 'bg-emerald-dim/40 border-emerald-dim text-emerald'
                    : 'bg-accent-dim/40 border-accent-dim text-accent-soft'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-accent" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Multi-Directory Management */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-ink-2 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-amber" />
                <span>{t('扫描根目录列表（可添加任意多个不同存储盘/路径）')}</span>
              </label>
              <span className="text-[11px] text-muted-2">{t('已配置 {n} 个路径', { n: directories.length })}</span>
            </div>

            {/* List of directories */}
            <div className="space-y-2 mb-3">
              {directories.map((dir, idx) => (
                <div
                  key={idx}
                  className="group flex items-center justify-between p-2.5 bg-app border border-line rounded-xl hover:border-line-strong transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <Folder className="w-4 h-4 text-muted-2 group-hover:text-amber transition-colors shrink-0" />
                    <span className="font-mono text-xs text-ink-2 truncate select-all">{dir}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleScanSingle(dir)}
                      disabled={isScanning}
                      title={t('只扫描此目录')}
                      className="px-2.5 py-1 text-[11px] bg-surface hover:bg-surface-2 text-ink-3 rounded-lg border border-line transition-colors"
                    >
                      {t('单独扫描')}
                    </button>
                    <button
                      onClick={() => handleRemoveDirectory(dir)}
                      title={t('移除此目录')}
                      className="p-1.5 text-muted-2 hover:text-accent hover:bg-surface rounded-lg transition-colors"
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
                placeholder={t('输入绝对路径，例如 /home/you/Music 或 D:/Music')}
                className="flex-1 px-3 py-2 bg-app border border-line rounded-xl text-ink-2 font-mono text-xs focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleAddDirectory}
                disabled={!newDirPath.trim()}
                className="px-3.5 py-2 bg-surface-2 hover:bg-elevated disabled:opacity-40 text-ink-2 rounded-xl font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderPlus className="w-3.5 h-3.5 text-emerald" />
                <span>{t('添加路径')}</span>
              </button>
            </div>

            {/* Trigger Scan Button */}
            <div className="pt-3">
              <button
                onClick={handleScanAll}
                disabled={isScanning || directories.length === 0}
                className="w-full py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t('正在扫描各目录多媒体文件与标签元数据...')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>{t('重新扫描所有已配置目录 (POST /api/scan)')}</span>
                  </>
                )}
              </button>

              {/* Scan Result Feedback */}
              {scanResult && (
                <div className="mt-3 p-3.5 rounded-xl bg-app border border-emerald-dim/60 text-ink-2 space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-2 text-emerald font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{tServerMessage(scanResult.message)}</span>
                  </div>
                  {scanResult.scan_summary && (
                    <div className="text-[11px] text-muted grid grid-cols-3 gap-2 pt-1 border-t border-line-soft">
                      <div>{t('已收录文件:')} <span className="text-ink-2 font-mono">{scanResult.scan_summary.total_files}</span></div>
                      <div>{t('带内置标签:')} <span className="text-emerald font-mono">{scanResult.scan_summary.tagged_files}</span></div>
                      <div>{t('目录/文件名解析:')} <span className="text-amber font-mono">{scanResult.scan_summary.path_parsed_files}</span></div>
                    </div>
                  )}
                </div>
              )}

              {scanError && (
                <div className="mt-3 p-3 rounded-xl bg-accent-dim/40 border border-accent-dim text-accent-soft flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-accent" />
                  <span>{scanError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Architecture & Scanning Strategy Info Card */}
          <div className="p-4 rounded-xl bg-app border border-line space-y-2.5">
            <div className="flex items-center gap-2 text-accent font-medium">
              <AlertCircle className="w-4 h-4" />
              <span>{t('扫描与缓存策略说明')}</span>
            </div>
            <div className="text-[11px] text-muted leading-relaxed space-y-1.5">
              <p>
                {t('针对您不同的目录存放情况（如')} <code className="text-ink-3">KuGou/flac</code> {t('与')} <code className="text-ink-3">youtube</code>{t('、')}<code className="text-ink-3">youtube-music</code>{t('）：')}
              </p>
              <ul className="list-disc pl-4 space-y-1 text-muted">
                <li>
                  <strong className="text-ink-2">{t('无缝多目录支持')}</strong>{t('：后端支持维护多个扫描根目录，无论歌曲分布在不同分区还是子文件夹，均可一次性扫描合并索引。')}
                </li>
                <li>
                  <strong className="text-ink-2">{t('内置标签优先提取 (music-metadata)')}</strong>{t('：针对 FLAC/MP3/MP4 等文件，优先读取其内部的 ID3/Vorbis/MP4 元数据标签（标题、歌手、专辑、时长）。')}
                </li>
                <li>
                  <strong className="text-ink-2">{t('智能目录与文件名回退')}</strong>{t('：对于 YouTube 下载或酷狗批量下载等无内置标签的文件，系统自动识别标准分层结构（')}<code className="text-ink-3">{t('歌手/专辑/歌曲')}</code>{t(')，并支持从形如 ')}<code className="text-ink-3">{t('歌手 - 歌名')}</code>{t(' 的文件名中解析出歌手与曲名，专辑自动归类，不会出现混乱或识别失败。')}
                </li>
                <li>
                  <strong className="text-ink-2">{t('增量扫描')}</strong>{t('：已索引且 (修改时间, 大小) 未变化的文件会被跳过，只有新增或改动的文件才重新解析元数据。')}
                </li>
                <li>
                  <strong className="text-ink-2">{t('封面 / 歌词缓存')}</strong>{t('：封面三级兜底（本地内嵌 → iTunes → 网易云）存 ')}<code className="text-ink-3">covers/</code>{t('；歌词来自网易云明文接口，存 ')}<code className="text-ink-3">lyrics/</code>{t('，索引在 ')}<code className="text-ink-3">fastmusic_covers.json</code> / <code className="text-ink-3">fastmusic_lyrics.json</code>.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface/90 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface-2 hover:bg-elevated text-ink-2 rounded-xl text-xs font-medium transition-colors"
          >
            {t('完成并关闭')}
          </button>
        </div>
      </div>
    </div>
  );
};
