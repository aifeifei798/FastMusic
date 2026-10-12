import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Play, 
  Film, 
  Music, 
  Search, 
  User, 
  Disc, 
  SlidersHorizontal,
  X,
  Database,
  ArrowDownCircle,
  RefreshCw,
  CheckCircle2,
  Heart,
  Loader2,
  Clock,
  AlertTriangle,
  Captions
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, TranscodeInfo, TranscodeSummary, TrackSort } from '../types/media';
import { mediaApi } from '../services/api';
import { SCROLLBAR_CLASSES, NO_SCROLLBAR_CLASSES } from '../utils/ui';

interface LibraryViewProps {
  tracks: MediaItem[];
  totalTracks: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  currentTrackId: string | null;
  onSelectTrack: (track: MediaItem) => void;
  onScanClick: () => void;
  isScanning: boolean;
  selectedArtist: string | null;
  selectedAlbum: string | null;
  onFilterArtist: (artist: string | null) => void;
  onFilterAlbum: (album: string | null) => void;
  mediaTypeFilter: 'all' | 'audio' | 'video';
  onFilterMediaType: (type: 'all' | 'audio' | 'video') => void;
  readyOnly?: boolean;
  onToggleReadyOnly?: () => void;
  sort?: TrackSort;
  onSortChange?: (sort: TrackSort) => void;
  rowDensity?: 'comfortable' | 'compact';
  onToggleDensity?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  favoriteIds?: Set<string>;
  favorites?: MediaItem[];
  onToggleFavorite?: (track: MediaItem) => void;
  activeTab?: 'tracks' | 'artists' | 'albums' | 'favorites';
  onTabChange?: (tab: 'tracks' | 'artists' | 'albums' | 'favorites') => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  tracks,
  totalTracks,
  hasMore,
  isLoadingMore,
  onLoadMore,
  artists,
  albums,
  currentTrackId,
  onSelectTrack,
  onScanClick,
  isScanning,
  selectedArtist,
  selectedAlbum,
  onFilterArtist,
  onFilterAlbum,
  mediaTypeFilter,
  onFilterMediaType,
  readyOnly = false,
  onToggleReadyOnly,
  sort = 'default',
  onSortChange,
  rowDensity = 'comfortable',
  onToggleDensity,
  searchQuery,
  onSearchChange,
  favoriteIds = new Set(),
  favorites = [],
  onToggleFavorite,
  activeTab: propActiveTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<'tracks' | 'artists' | 'albums' | 'favorites'>('tracks');
  const activeTab = propActiveTab !== undefined ? propActiveTab : internalTab;
  const setActiveTab = (tab: 'tracks' | 'artists' | 'albums' | 'favorites') => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const [letterFilter, setLetterFilter] = useState<string>('ALL');
  // 歌手 / 专辑标签的排序方式（网格卡片没有服务端排序，客户端排即可）
  const [entitySort, setEntitySort] = useState<'name' | 'count'>('name');
  // 网格只渲染前 N 张卡片，滚动触底再追加，避免 1.5 万张专辑卡片一次性塞进 DOM
  const [artistLimit, setArtistLimit] = useState(120);
  const [albumLimit, setAlbumLimit] = useState(120);

  // The internal scroll box — auto-appends the next batch only when the user has
  // actually scrolled near the bottom of the currently-loaded content, so memory
  // stays bounded instead of loading the entire library at once.
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);

  const handleScrollBox = () => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (hasMore && !isLoadingMore && distanceToBottom < 120) {
      onLoadMore();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1000) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  // 无封面时用标题 hash 生成确定性渐变占位，视觉比统一灰块更协调
  const coverGradient = (text: string): string => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const hue = (h >>> 0) % 360;
    return `linear-gradient(135deg, hsl(${hue} 40% 24%), hsl(${(hue + 45) % 360} 50% 12%))`;
  };

  // 时长 mm:ss（duration 缺失时返回空串，避免显示 0:00 误导）
  const formatDuration = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // .mkv 换容器(remux)状态：/api/tracks 响应带初始值，之后每 10s 轮询刷新，
  // 这样后台预转码队列的进度（排队 → 转码中 → 已就绪）在列表里是活的。
  const tracksRef = useRef<MediaItem[]>(tracks);
  tracksRef.current = tracks;
  const [transcodeById, setTranscodeById] = useState<Record<string, TranscodeInfo>>({});
  const [transcodeSummary, setTranscodeSummary] = useState<TranscodeSummary | null>(null);

  useEffect(() => {
    const refresh = async () => {
      const ids = tracksRef.current.filter((t) => t.ext === '.mkv').map((t) => t.id);
      const [summary, batch] = await Promise.all([
        mediaApi.getTranscodeSummary(),
        mediaApi.getTranscodeStatusBatch(ids),
      ]);
      if (summary) setTranscodeSummary(summary);
      if (Object.keys(batch).length > 0) {
        setTranscodeById((prev) => ({ ...prev, ...batch }));
      }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  const getTranscode = (track: MediaItem): TranscodeInfo | undefined =>
    transcodeById[track.id] || track.transcode;

  // 转码状态徽章（仅 .mkv 有）
  const transcodeBadge = (track: MediaItem) => {
    const info = getTranscode(track);
    if (!info) return null;
    const sidecar = info.out_size ? formatFileSize(info.out_size) : '';
    if (info.status === 'ready') {
      return (
        <span
          title={`已转码为 ${info.container || 'webm'} sidecar${sidecar ? ` (${sidecar})` : ''}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-900/25 text-emerald-300 border border-emerald-700/40"
        >
          <CheckCircle2 className="w-3 h-3" />
          <span>{(info.container || 'webm').toUpperCase()}</span>
        </span>
      );
    }
    if (info.status === 'running') {
      return (
        <span
          title="正在 remux/转码，完成后自动可播"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900/25 text-amber-300 border border-amber-700/40"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{info.progress > 0 ? `转码 ${info.progress}%` : '转码中'}</span>
        </span>
      );
    }
    if (info.status === 'queued') {
      return (
        <span
          title="排队等待转码（后台队列按文件从小到大处理）"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700/50"
        >
          <Clock className="w-3 h-3" />
          <span>排队</span>
        </span>
      );
    }
    if (info.status === 'error') {
      return (
        <span
          title={info.progress === 0 ? '转码失败' : '转码失败'}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-900/25 text-rose-300 border border-rose-700/40"
        >
          <AlertTriangle className="w-3 h-3" />
          <span>转码失败</span>
        </span>
      );
    }
    return (
      <span
        title="未入转码队列（PRETRANCODE_MKV=0 或新扫描的文件）"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800/60 text-neutral-500 border border-dashed border-neutral-700/60"
      >
        <Clock className="w-3 h-3" />
        <span>待转码</span>
      </span>
    );
  };

  // 搜索框也作用于歌手 / 专辑标签：输入关键词时只保留名字包含它的条目
  const q = searchQuery.trim().toLowerCase();

  // Filtered artists by A-Z letter（字母索引 + 搜索 + 排序）
  const filteredArtists = useMemo(() => {
    const list = artists.filter(a => {
      if (q && !a.artist_name.toLowerCase().includes(q)) return false;
      if (letterFilter === 'ALL') return true;
      const firstChar = a.artist_name.trim().charAt(0).toUpperCase();
      if (letterFilter === '#') return !/[A-Z]/.test(firstChar);
      return firstChar === letterFilter;
    });
    if (entitySort === 'count') {
      list.sort((a, b) => b.track_count - a.track_count || a.artist_name.localeCompare(b.artist_name, 'zh'));
    } else {
      list.sort((a, b) => a.artist_name.localeCompare(b.artist_name, 'zh'));
    }
    return list;
  }, [artists, letterFilter, q, entitySort]);

  // Filtered albums by A-Z letter（字母索引 + 搜索 + 排序）
  const filteredAlbums = useMemo(() => {
    const list = albums.filter(a => {
      if (q && !(a.album_name.toLowerCase().includes(q) || a.artist_name.toLowerCase().includes(q))) return false;
      if (letterFilter === 'ALL') return true;
      const firstChar = a.album_name.trim().charAt(0).toUpperCase();
      if (letterFilter === '#') return !/[A-Z]/.test(firstChar);
      return firstChar === letterFilter;
    });
    if (entitySort === 'count') {
      list.sort((a, b) => b.track_count - a.track_count || a.album_name.localeCompare(b.album_name, 'zh'));
    } else {
      list.sort((a, b) => a.album_name.localeCompare(b.album_name, 'zh'));
    }
    return list;
  }, [albums, letterFilter, q, entitySort]);

  // 网格标签的滚动容器：触底时追加下一批卡片（与曲目列表的无限滚动同一思路）
  const gridBoxRef = useRef<HTMLDivElement | null>(null);
  const handleGridScroll = () => {
    const el = gridBoxRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 240) {
      if (activeTab === 'artists') setArtistLimit((n) => n + 120);
      else if (activeTab === 'albums') setAlbumLimit((n) => n + 120);
    }
  };

  const alphabet = ['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'];

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col gap-4">
      {/* Search & Top Action Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Navigation Tabs — 标签精简, 把宽度让给搜索框 */}
        <div className="flex items-center gap-1 p-1 bg-neutral-900 rounded-xl border border-neutral-800 shrink-0">
          <button
            onClick={() => setActiveTab('tracks')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'tracks'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            曲目 {tracks.length}/{totalTracks}
          </button>
          <button
            onClick={() => setActiveTab('artists')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'artists'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            歌手/UP主 {artists.length}
          </button>
          <button
            onClick={() => setActiveTab('albums')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'albums'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            专辑 {albums.length}
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'favorites'
                ? 'bg-neutral-800 text-rose-300 shadow-sm border border-rose-500/30'
                : 'text-neutral-400 hover:text-rose-300'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorites.length > 0 ? 'fill-rose-500 text-rose-500' : 'text-neutral-400'}`} />
            <span>我的收藏 ({favorites.length})</span>
          </button>
        </div>

        {/* Search & Filter — 允许换行, 窄屏不至于挤成一条溢出 */}
        <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
          {/* Search box — 占据剩余宽度，搜索框更长更容易读长查询 */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="搜索曲目、歌手或专辑..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-rose-500/80 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 搜索命中数: 防抖后服务端返回的总数 */}
          {searchQuery && (
            <span className="text-[11px] font-mono text-neutral-500 shrink-0">命中 {totalTracks}</span>
          )}

          {/* Media Type Toggle */}
          <div className="flex items-center gap-1 p-1 bg-neutral-900 rounded-xl border border-neutral-800 shrink-0">
            <button
              onClick={() => onFilterMediaType('all')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                mediaTypeFilter === 'all'
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => onFilterMediaType('video')}
              className={`px-2.5 py-1 text-xs rounded-lg flex items-center gap-1 transition-colors ${
                mediaTypeFilter === 'video'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Film className="w-3 h-3" />
              MTV
            </button>
            <button
              onClick={() => onFilterMediaType('audio')}
              className={`px-2.5 py-1 text-xs rounded-lg flex items-center gap-1 transition-colors ${
                mediaTypeFilter === 'audio'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Music className="w-3 h-3" />
              音乐
            </button>
          </div>

          {/* 只看已转码：隐藏排队/转码中的 .mkv，只留下可直接播的条目 */}
          {onToggleReadyOnly && (
            <button
              onClick={onToggleReadyOnly}
              title="只显示已转码(或无需转码)的曲目；排队中和转码中的 .mkv 会被隐藏"
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 shrink-0 ${
                readyOnly
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                  : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>只看已转码</span>
            </button>
          )}

          {/* 排序: 服务端 /api/tracks 的 sort 参数（默认 = 扫描索引顺序） */}
          {onSortChange && (
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as TrackSort)}
              title="列表排序"
              className="px-2.5 py-1.5 text-xs rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white cursor-pointer shrink-0"
            >
              <option value="default">默认顺序</option>
              <option value="title">标题 A→Z</option>
              <option value="artist">歌手 A→Z</option>
              <option value="album">专辑 A→Z</option>
              <option value="duration">时长</option>
              <option value="size">文件大小</option>
              <option value="mtime">文件日期</option>
              <option value="random">随机</option>
            </select>
          )}

          {/* 行密度: 标准 / 紧凑（紧凑隐藏专辑列, 每屏多几行） */}
          {onToggleDensity && (
            <button
              onClick={onToggleDensity}
              title={rowDensity === 'compact' ? '当前紧凑模式，点击恢复标准行高' : '当前标准模式，点击切换紧凑行高'}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors shrink-0 ${
                rowDensity === 'compact'
                  ? 'bg-neutral-800 text-white border-neutral-700'
                  : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
              }`}
            >
              {rowDensity === 'compact' ? '紧凑' : '标准'}
            </button>
          )}

          {/* .mkv 换容器(remux)进度统计：已就绪 / 进行中 / 排队 */}
          {transcodeSummary && transcodeSummary.total_mkv > 0 && (
            <div
              title={`全库 ${transcodeSummary.total_mkv} 个 .mkv：已转码 ${transcodeSummary.ready}，转码中 ${transcodeSummary.running}，排队 ${transcodeSummary.queued}${transcodeSummary.pending ? `，未入队 ${transcodeSummary.pending}` : ''}${transcodeSummary.error ? `，失败 ${transcodeSummary.error}` : ''}`}
              className="flex items-center gap-2 shrink-0 text-[11px] font-medium text-neutral-400"
            >
              <span className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {transcodeSummary.ready}/{transcodeSummary.total_mkv}
              </span>
              {transcodeSummary.running > 0 && (
                <span className="flex items-center gap-1 text-amber-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {transcodeSummary.running}
                </span>
              )}
              {(transcodeSummary.queued > 0 || transcodeSummary.pending > 0) && (
                <span className="flex items-center gap-1 text-neutral-500">
                  <Clock className="w-3.5 h-3.5" />
                  {transcodeSummary.queued + transcodeSummary.pending}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* A-Z Alphabet quick navigation for Artists / Albums */}
      {(activeTab === 'artists' || activeTab === 'albums') && (
        <div className={`flex items-center gap-1 overflow-x-auto py-1 px-2 bg-neutral-900/40 rounded-xl border border-neutral-800/80 ${NO_SCROLLBAR_CLASSES}`}>
          <span className="text-[11px] text-neutral-500 px-1 font-mono">字母索引:</span>
          {alphabet.map((char) => (
            <button
              key={char}
              onClick={() => setLetterFilter(char)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 ${
                letterFilter === char
                  ? 'bg-rose-600 text-white font-bold'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              {char}
            </button>
          ))}
        </div>
      )}

      {/* Active Filter Bar (when filtering by artist or album) */}
      {(selectedArtist || selectedAlbum) && (
        <div className="flex items-center gap-2 p-2.5 bg-neutral-900/60 rounded-xl border border-neutral-800 text-xs text-neutral-300">
          <SlidersHorizontal className="w-3.5 h-3.5 text-rose-400" />
          <span>正在筛选:</span>
          {selectedArtist && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 text-white">
              歌手: {selectedArtist}
              <button
                onClick={() => onFilterArtist(null)}
                className="hover:text-rose-400 ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {selectedAlbum && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 text-white">
              专辑: {selectedAlbum}
              <button
                onClick={() => onFilterAlbum(null)}
                className="hover:text-rose-400 ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button
            onClick={() => {
              onFilterArtist(null);
              onFilterAlbum(null);
            }}
            className="text-neutral-500 hover:text-neutral-300 ml-auto text-xs underline"
          >
            清除所有筛选
          </button>
        </div>
      )}

      {/* Tab 1: Tracks List with Infinite Scroll (触底自动追加) */}
      {activeTab === 'tracks' && (
        <div className="w-full flex-1 min-h-0 bg-neutral-900/40 rounded-2xl border border-neutral-800/80 overflow-hidden flex flex-col">
          {totalTracks === 0 ? (
            <div className="p-12 text-center text-neutral-500 flex flex-col items-center">
              <Music className="w-12 h-12 stroke-1 text-neutral-600 mb-3" />
              <p className="text-base font-medium text-neutral-300">暂无匹配的媒体文件</p>
              <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                未在当前筛选中找到曲目。您可以重置筛选，或通过顶部“重新扫描”扫描本地媒体目录。
              </p>
              <button
                onClick={onScanClick}
                disabled={isScanning}
                className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-xl transition-colors"
              >
                {isScanning ? '正在扫描媒体库...' : '触发 API 重新扫描'}
              </button>
            </div>
          ) : (
            <>
              {/* Scrollable list box: 高度由 main 的剩余空间决定（有下限，避免行被压扁），
                  这样小屏不会把列表裁掉, 页脚始终可见 */}
              <div ref={scrollBoxRef} onScroll={handleScrollBox} className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}>
              {/* Header row with performance indicator — pinned while the rows scroll */}
              <div className={`sticky top-0 z-10 hidden sm:grid grid-cols-12 gap-4 px-5 ${rowDensity === 'compact' ? 'py-2' : 'py-3'} text-[11px] font-semibold text-neutral-400 tracking-wider uppercase bg-neutral-900/70 border-b border-neutral-800/60`}>
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">曲目标题 / 艺术家</div>
                {rowDensity === 'compact' ? (
                  <div className="col-span-3 text-center">时长</div>
                ) : (
                  <div className="col-span-3">所属专辑</div>
                )}
                <div className="col-span-1 text-center">格式</div>
                <div className="col-span-2 text-right">大小 / 操作</div>
              </div>

              {/* Rows List */}
              <div className="divide-y divide-neutral-800/60">
                {tracks.map((track, idx) => {
                  const isCurrent = track.id === currentTrackId;
                  const isVideo = track.media_type === 'video';
                  const isFavorited = favoriteIds.has(track.id);

                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`grid grid-cols-12 gap-2 sm:gap-4 px-4 sm:px-5 ${rowDensity === 'compact' ? 'py-1.5' : 'py-3'} items-center text-xs transition-colors group cursor-pointer relative ${
                        isCurrent
                          ? 'bg-rose-950/40 text-rose-300 font-medium border-l-2 border-l-rose-500'
                          : isFavorited
                          ? 'bg-rose-950/20 hover:bg-rose-950/35 text-neutral-100 border-l-2 border-l-rose-500/80 shadow-inner'
                          : 'hover:bg-neutral-800/50 text-neutral-300'
                      }`}
                      onClick={() => onSelectTrack(track)}
                    >
                      {/* Index / Play icon */}
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-center">
                        {isCurrent ? (
                          <div className="flex items-center gap-0.5">
                            <span className="w-1 h-3 bg-rose-500 rounded-full animate-bounce" />
                            <span className="w-1 h-4 bg-rose-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                            <span className="w-1 h-2.5 bg-rose-600 rounded-full animate-bounce [animation-delay:0.3s]" />
                          </div>
                        ) : (
                          <span className="font-mono text-neutral-500 group-hover:hidden tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        )}
                        {!isCurrent && (
                          <Play className="w-3.5 h-3.5 text-rose-400 hidden group-hover:block" />
                        )}
                      </div>

                      {/* Title and Artist */}
                      <div className="col-span-8 sm:col-span-5 flex items-center gap-3 min-w-0">
                        <div className={`${rowDensity === 'compact' ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 overflow-hidden relative`} style={track.cover_url ? undefined : { background: coverGradient(track.title) }}>
                          {track.cover_url ? (
                            <img
                              src={track.cover_url}
                              alt={track.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : isVideo ? (
                            <Film className="w-4 h-4 text-rose-400" />
                          ) : (
                            <Music className="w-4 h-4 text-neutral-400" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`truncate font-medium ${isCurrent ? 'text-rose-300' : isFavorited ? 'text-white' : 'text-neutral-100 group-hover:text-white'}`}>
                              {track.title}
                            </div>
                            {isFavorited && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                                <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                                <span>已收藏</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onFilterArtist(track.artist);
                              }}
                              className="hover:text-rose-400 hover:underline"
                            >
                              {track.artist}
                            </span>
                            {rowDensity === 'comfortable' && formatDuration(track.duration) && (
                              <span aria-hidden="true" className="text-neutral-600">·</span>
                            )}
                            {rowDensity === 'comfortable' && formatDuration(track.duration) && (
                              <span className="font-mono tabular-nums text-neutral-500">{formatDuration(track.duration)}</span>
                            )}
                            {track.lyric === 'yes' && (
                              <span title="有歌词（网易云歌词缓存）" className="shrink-0">
                                <Captions className="w-3 h-3 text-rose-400" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 专辑（标准模式） / 时长（紧凑模式） */}
                      {rowDensity === 'compact' ? (
                        <div className="hidden sm:flex sm:col-span-3 items-center justify-center font-mono text-[11px] text-neutral-500 tabular-nums">
                          {formatDuration(track.duration) || '—'}
                        </div>
                      ) : (
                        <div className="hidden sm:block sm:col-span-3 text-neutral-400 truncate">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onFilterAlbum(track.album);
                            }}
                            className="hover:text-neutral-200 hover:underline"
                          >
                            {track.album}
                          </span>
                        </div>
                      )}

                      {/* Type badge */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center">
                        <span
                          className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                            isVideo
                              ? 'bg-rose-900/30 text-rose-300 border border-rose-800/40'
                              : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                          }`}
                        >
                          {track.ext.replace('.', '').toUpperCase()}
                        </span>
                      </div>

                      {/* Size and Quick Action */}
                      <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1.5 sm:gap-2 text-right">
                        <span className="hidden md:inline font-mono text-[11px] text-neutral-500 tabular-nums">
                          {formatFileSize(track.file_size)}
                        </span>

                        {transcodeBadge(track)}

                        {onToggleFavorite && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(track);
                            }}
                            title={isFavorited ? '取消收藏' : '添加至收藏'}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              isFavorited
                                ? 'text-rose-500 hover:text-rose-400 opacity-100'
                                : 'text-neutral-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 focus:opacity-100'
                            }`}
                          >
                            <Heart className={`w-4 h-4 transition-transform active:scale-125 ${isFavorited ? 'fill-rose-500 text-rose-500' : ''}`} />
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
              </div>

              {/* ================= FOOTER (stays visible below the scroll box) ================= */}
              <div className="px-4 py-2.5 bg-neutral-900/80 border-t border-neutral-800/60 flex items-center justify-between gap-3 text-xs text-neutral-400">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-rose-400 font-medium">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在拉取下一批曲目 (offset={tracks.length})...</span>
                    </div>
                  ) : hasMore ? (
                    <span className="text-neutral-400">
                      已加载 <strong className="text-white font-mono">{tracks.length}</strong> / <strong className="text-rose-400 font-mono">{totalTracks}</strong> 首 · 向下滚动自动追加
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5 text-neutral-400">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>已加载全部 <strong className="text-neutral-200 font-mono">{totalTracks}</strong> 首</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const el = scrollBoxRef.current;
                    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  title="回到列表顶部"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  <ArrowDownCircle className="w-3.5 h-3.5 rotate-180" />
                  <span>回到顶部</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Artists Grid — 独立滚动容器 + 分批渲染，卡片多时也能向下浏览 */}
      {activeTab === 'artists' && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-neutral-400">
            <span>
              共收录 <strong className="text-white">{filteredArtists.length}</strong> 位艺术家 / UP主
              <span className="ml-2 font-mono text-neutral-500">· 已渲染 {Math.min(artistLimit, filteredArtists.length)}</span>
            </span>
            <select
              value={entitySort}
              onChange={(e) => setEntitySort(e.target.value as 'name' | 'count')}
              className="px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 cursor-pointer"
            >
              <option value="name">按名称</option>
              <option value="count">按作品数</option>
            </select>
          </div>
          <div
            ref={gridBoxRef}
            onScroll={handleGridScroll}
            className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredArtists.slice(0, artistLimit).map((artist) => (
                <div
                  key={artist.artist_name}
                  onClick={() => {
                    onFilterArtist(artist.artist_name);
                    setActiveTab('tracks');
                  }}
                  className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 hover:border-rose-500/50 hover:bg-neutral-800/40 transition-all cursor-pointer group flex flex-col items-center text-center"
                >
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-neutral-800 border-2 border-neutral-700 group-hover:border-rose-500/80 transition-colors shadow-lg mb-3 flex items-center justify-center">
                    {artist.avatar_url ? (
                      <img
                        src={artist.avatar_url}
                        alt={artist.artist_name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <User className="w-8 h-8 text-neutral-500" />
                    )}
                  </div>
                  <h4 className="font-semibold text-sm text-neutral-100 group-hover:text-rose-400 truncate w-full">
                    {artist.artist_name}
                  </h4>
                  <p className="text-xs text-neutral-400 mt-1">
                    {artist.album_count} 张专辑 · {artist.track_count} 首作品
                  </p>
                </div>
              ))}
            </div>
            {artistLimit < filteredArtists.length && (
              <div className="flex justify-center mt-3">
                <button
                  onClick={() => setArtistLimit((n) => n + 120)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white hover:border-rose-500/50 transition-colors cursor-pointer"
                >
                  加载更多 ({filteredArtists.length - artistLimit})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Albums Grid — 同样独立滚动 + 分批渲染 */}
      {activeTab === 'albums' && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-neutral-400">
            <span>
              共收录 <strong className="text-white">{filteredAlbums.length}</strong> 张专辑
              <span className="ml-2 font-mono text-neutral-500">· 已渲染 {Math.min(albumLimit, filteredAlbums.length)}</span>
            </span>
            <select
              value={entitySort}
              onChange={(e) => setEntitySort(e.target.value as 'name' | 'count')}
              className="px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 cursor-pointer"
            >
              <option value="name">按名称</option>
              <option value="count">按曲目数</option>
            </select>
          </div>
          <div
            ref={gridBoxRef}
            onScroll={handleGridScroll}
            className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredAlbums.slice(0, albumLimit).map((album) => (
                <div
                  key={`${album.artist_name}-${album.album_name}`}
                  onClick={() => {
                    onFilterAlbum(album.album_name);
                    setActiveTab('tracks');
                  }}
                  className="p-3 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 hover:border-rose-500/50 hover:bg-neutral-800/40 transition-all cursor-pointer group flex flex-col"
                >
                  <div className="aspect-square w-full rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700/80 group-hover:border-rose-500/80 transition-colors shadow-lg mb-3 flex items-center justify-center">
                    {album.cover_url ? (
                      <img
                        src={album.cover_url}
                        alt={album.album_name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-neutral-500" />
                    )}
                  </div>
                  <h4 className="font-semibold text-xs text-neutral-100 group-hover:text-rose-400 truncate">
                    {album.album_name}
                  </h4>
                  <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                    {album.artist_name}
                  </p>
                  <p className="text-[10px] text-neutral-500 mt-1 font-mono">
                    {album.track_count} 首曲目
                  </p>
                </div>
              ))}
            </div>
            {albumLimit < filteredAlbums.length && (
              <div className="flex justify-center mt-3">
                <button
                  onClick={() => setAlbumLimit((n) => n + 120)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white hover:border-rose-500/50 transition-colors cursor-pointer"
                >
                  加载更多 ({filteredAlbums.length - albumLimit})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Favorites List */}
      {activeTab === 'favorites' && (
        <div className="w-full flex-1 min-h-0 bg-neutral-900/40 rounded-2xl border border-neutral-800/80 overflow-hidden flex flex-col">
          {favorites.length === 0 ? (
            <div className="p-12 text-center text-neutral-500 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-rose-950/30 border border-rose-800/40 flex items-center justify-center text-rose-400 mb-3 shadow-inner">
                <Heart className="w-8 h-8" />
              </div>
              <p className="text-base font-medium text-neutral-200">暂无收藏的曲目</p>
              <p className="text-xs text-neutral-400 mt-1.5 max-w-sm leading-relaxed">
                在播放卡片区域或曲目列表中点击心形爱心 (Heart) 按钮，即可将喜爱的无损音乐与高清 MTV 保存到此处。
              </p>
              <button
                onClick={() => setActiveTab('tracks')}
                className="mt-5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-md"
              >
                浏览全部曲目
              </button>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="hidden sm:grid grid-cols-12 gap-4 px-5 py-3 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase bg-neutral-900/70 border-b border-neutral-800/60">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">曲目标题 / 艺术家</div>
                <div className="col-span-3">所属专辑</div>
                <div className="col-span-1 text-center">格式</div>
                <div className="col-span-2 text-right">大小 / 操作</div>
              </div>

              {/* Rows List — 高度由 main 的剩余空间决定（有下限，避免行被压扁），页脚始终可见 */}
              <div className={`divide-y divide-neutral-800/60 overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}>
                {favorites.map((track, idx) => {
                  const isCurrent = track.id === currentTrackId;
                  const isVideo = track.media_type === 'video';

                  return (
                    <div
                      key={`fav-${track.id}-${idx}`}
                      className={`grid grid-cols-12 gap-2 sm:gap-4 px-4 sm:px-5 py-3 items-center text-xs transition-colors group cursor-pointer relative ${
                        isCurrent
                          ? 'bg-rose-950/40 text-rose-300 font-medium border-l-2 border-l-rose-500'
                          : 'bg-rose-950/15 hover:bg-rose-950/30 text-neutral-100 border-l-2 border-l-rose-500/80 shadow-inner'
                      }`}
                      onClick={() => onSelectTrack(track)}
                    >
                      {/* Index / Play icon */}
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-center">
                        {isCurrent ? (
                          <div className="flex items-center gap-0.5">
                            <span className="w-1 h-3 bg-rose-500 rounded-full animate-bounce" />
                            <span className="w-1 h-4 bg-rose-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                            <span className="w-1 h-2.5 bg-rose-600 rounded-full animate-bounce [animation-delay:0.3s]" />
                          </div>
                        ) : (
                          <span className="font-mono text-neutral-500 group-hover:hidden tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        )}
                        {!isCurrent && (
                          <Play className="w-3.5 h-3.5 text-rose-400 hidden group-hover:block" />
                        )}
                      </div>

                      {/* Title and Artist */}
                      <div className="col-span-8 sm:col-span-5 flex items-center gap-3 min-w-0">
                        <div className={`${rowDensity === 'compact' ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 overflow-hidden relative`} style={track.cover_url ? undefined : { background: coverGradient(track.title) }}>
                          {track.cover_url ? (
                            <img
                              src={track.cover_url}
                              alt={track.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : isVideo ? (
                            <Film className="w-4 h-4 text-rose-400" />
                          ) : (
                            <Music className="w-4 h-4 text-neutral-400" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="truncate font-medium text-white">
                              {track.title}
                            </div>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                              <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                              <span>已收藏</span>
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onFilterArtist(track.artist);
                                setActiveTab('tracks');
                              }}
                              className="hover:text-rose-400 hover:underline"
                            >
                              {track.artist}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Album */}
                      <div className="hidden sm:block sm:col-span-3 text-neutral-400 truncate">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onFilterAlbum(track.album);
                            setActiveTab('tracks');
                          }}
                          className="hover:text-neutral-200 hover:underline"
                        >
                          {track.album}
                        </span>
                      </div>

                      {/* Type badge */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center">
                        <span
                          className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                            isVideo
                              ? 'bg-rose-900/30 text-rose-300 border border-rose-800/40'
                              : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                          }`}
                        >
                          {track.ext.replace('.', '').toUpperCase()}
                        </span>
                      </div>

                      {/* Size and Quick Action */}
                      <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1.5 sm:gap-2 text-right">
                        <span className="hidden md:inline font-mono text-[11px] text-neutral-500 tabular-nums">
                          {formatFileSize(track.file_size)}
                        </span>

                        {transcodeBadge(track)}

                        {onToggleFavorite && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(track);
                            }}
                            title="取消收藏"
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer info */}
              <div className="p-3 bg-neutral-900/70 border-t border-neutral-800/60 text-center text-xs text-neutral-400">
                已在本地收藏 <strong className="text-rose-400 font-mono">{favorites.length}</strong> 首曲目 (存储于 localStorage 'favorites')
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
