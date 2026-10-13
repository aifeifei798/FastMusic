import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Play, 
  Film, 
  Music, 
  Search, 
  User, 
  Disc, 
  ListMusic,
  Layers,
  SlidersHorizontal,
  X,
  Database,
  ArrowUp,
  RefreshCw,
  CheckCircle2,
  Heart,
  Loader2,
  Clock,
  AlertTriangle,
  Captions,
  ChevronDown
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, TranscodeInfo, TrackSort } from '../types/media';
import { mediaApi } from '../services/api';
import { SCROLLBAR_CLASSES, NO_SCROLLBAR_CLASSES } from '../utils/ui';
import { currentTheme, coverGradient as themeCoverGradient } from '../utils/theme';
import { t } from '../utils/i18n';

// 标签上的数字缩写：33878 → 33.9k，让工具栏在窄屏也能一行装下
const fmtNum = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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
  selectedArtist: string | null;
  selectedAlbum: string | null;
  onFilterArtist: (artist: string | null) => void;
  onFilterAlbum: (album: string | null) => void;
  mediaTypeFilter: 'all' | 'audio' | 'video';
  onFilterMediaType: (type: 'all' | 'audio' | 'video') => void;
  readyOnly?: boolean;
  onToggleReadyOnly?: () => void;
  hasLyricsOnly?: boolean;
  onToggleHasLyrics?: () => void;
  onLyricStatus?: (lyrics: Record<string, boolean>) => void;
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
  // 窄屏（<768px）布局：工具栏一行化、卡片两列、行左右滑动切歌
  isCompact?: boolean;
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
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
  selectedArtist,
  selectedAlbum,
  onFilterArtist,
  onFilterAlbum,
  mediaTypeFilter,
  onFilterMediaType,
  readyOnly = false,
  onToggleReadyOnly,
  hasLyricsOnly = false,
  onToggleHasLyrics,
  onLyricStatus,
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
  isCompact = false,
  onPrevTrack,
  onNextTrack,
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

  // 无封面时用标题 hash 生成确定性渐变占位，视觉比统一灰块更协调(深浅主题配色不同)
  const coverGradient = (text: string): string => themeCoverGradient(text, currentTheme());

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

  // 封面预取：服务端只在封面已解析/缓存时给出 cover_url，所以列表不会随手联网。
  // "预取封面"按钮批量解析当前已加载的条目（服务端并发 8，最多 200 条），
  // 结果存本地 map，行渲染直接用。
  const [coverById, setCoverById] = useState<Record<string, string | null>>({});
  const [coverPrefetching, setCoverPrefetching] = useState<boolean>(false);
  const [coverPrefetchInfo, setCoverPrefetchInfo] = useState<string>('');

  const coverOf = (track: MediaItem): string | undefined => track.cover_url || coverById[track.id] || undefined;

  // 歌手 / 专辑卡片：服务端已缓存的 avatar_url/cover_url，或预取回来的 cover_track_id 封面
  const entityCover = (e: ArtistSummary | AlbumSummary): string | undefined =>
    (e as ArtistSummary).avatar_url ||
    (e as AlbumSummary).cover_url ||
    (e.cover_track_id ? coverById[e.cover_track_id] || undefined : undefined);

  const handlePrefetchCovers = async () => {
    if (coverPrefetching) return;
    const ids = tracksRef.current.map((t) => t.id);
    if (ids.length === 0) return;
    setCoverPrefetching(true);
    const covers = await mediaApi.prefetchCovers(ids);
    setCoverById((prev) => ({ ...prev, ...covers }));
    const resolved = Object.values(covers).filter(Boolean).length;
    setCoverPrefetchInfo(t('封面预取完成：命中 {hits} / {total}', { hits: resolved, total: ids.length }));
    setCoverPrefetching(false);
  };

  // 歌词预取：服务端并发解析当前列表的网易云歌词并缓存，之后播放秒出歌词，
  // 「只看有歌词」筛选也依赖同一缓存（没预取过的曲目 lyric 为 null，会被过滤）。
  const [lyricPrefetching, setLyricPrefetching] = useState<boolean>(false);
  const [lyricPrefetchInfo, setLyricPrefetchInfo] = useState<string>('');

  const handlePrefetchLyrics = async () => {
    if (lyricPrefetching) return;
    const ids = tracksRef.current.map((t) => t.id);
    if (ids.length === 0) return;
    setLyricPrefetching(true);
    const res = await mediaApi.prefetchLyrics(ids);
    // 服务端缓存已写入，同步列表行的歌词 badge（否则要下次加载才更新）
    if (onLyricStatus) onLyricStatus(res.lyrics);
    setLyricPrefetchInfo(t('歌词预取完成：命中 {hits} / {total}', { hits: res.resolved, total: res.requested }));
    setLyricPrefetching(false);
  };

  // 「筛选与工具」下拉：只看已转码 / 只看有歌词 / 预取封面 / 预取歌词 / 行密度
  // 收进一个菜单，工具栏不再换行（窄屏尤其重要）。
  const [toolMenuOpen, setToolMenuOpen] = useState<boolean>(false);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!toolMenuRef.current?.contains(e.target as Element)) setToolMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolMenuOpen]);

  // 只轮询当前列表里 .mkv 的转码状态（行内徽章）。全库统计条已移到「系统配置」弹窗，
  // 工具栏不再显示转码汇总。
  useEffect(() => {
    const refresh = async () => {
      const ids = tracksRef.current.filter((t) => t.ext === '.mkv').map((t) => t.id);
      const batch = await mediaApi.getTranscodeStatusBatch(ids);
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
          title={t('已转码为 {container} sidecar', { container: info.container || 'webm' }) + (sidecar ? ` (${sidecar})` : '')}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-dim/25 text-emerald border border-emerald-dim/40"
        >
          <CheckCircle2 className="w-3 h-3" />
          <span>{(info.container || 'webm').toUpperCase()}</span>
        </span>
      );
    }
    if (info.status === 'running') {
      return (
        <span
          title={t('正在 remux/转码，完成后自动可播')}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-dim/25 text-amber border border-amber-dim/40"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{info.progress > 0 ? t('转码 {progress}%', { progress: info.progress }) : t('转码中')}</span>
        </span>
      );
    }
    if (info.status === 'queued') {
      return (
        <span
          title={t('排队等待转码（后台队列按文件从小到大处理）')}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-muted border border-line-strong/50"
        >
          <Clock className="w-3 h-3" />
          <span>{t('排队')}</span>
        </span>
      );
    }
    if (info.status === 'error') {
      return (
        <span
          title={t('转码失败')}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-dim/25 text-accent-soft border border-accent-dim/40"
        >
          <AlertTriangle className="w-3 h-3" />
          <span>{t('转码失败')}</span>
        </span>
      );
    }
    return (
      <span
        title={t('未入转码队列（PRETRANCODE_MKV=0 或新扫描的文件）')}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2/60 text-muted-2 border border-dashed border-line-strong/60"
      >
        <Clock className="w-3 h-3" />
        <span>{t('待转码')}</span>
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

  // 歌手 / 专辑卡片封面补全：服务端只在封面已缓存时给出 avatar_url / cover_url，
  // 这里用每条实体的 cover_track_id 后台批量解析（已请求过的 id 不再重复），
  // 结果写进 coverById，卡片下次渲染就有图。
  const entityCoverRequestedRef = useRef<Set<string>>(new Set());
  const [entityCoverInfo, setEntityCoverInfo] = useState<string>('');

  useEffect(() => {
    if (activeTab !== 'artists' && activeTab !== 'albums') return;
    const list = activeTab === 'artists'
      ? filteredArtists.slice(0, artistLimit)
      : filteredAlbums.slice(0, albumLimit);
    const ids = list
      .map((e) => e.cover_track_id)
      .filter((id): id is string => !!id && !entityCoverRequestedRef.current.has(id) && !(id in coverById));
    if (ids.length === 0) return;
    ids.forEach((id) => entityCoverRequestedRef.current.add(id));
    setEntityCoverInfo(t('补全封面 {total} 张…', { total: ids.length }));
    mediaApi.prefetchCovers(ids).then((covers) => {
      setCoverById((prev) => ({ ...prev, ...covers }));
      const resolved = Object.values(covers).filter(Boolean).length;
      setEntityCoverInfo(t('封面补全：命中 {hits} / {total}', { hits: resolved, total: ids.length }));
    });
  }, [activeTab, artistLimit, albumLimit, filteredArtists, filteredAlbums, coverById]);

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

  // 窄屏手势: 列表行左右滑动切歌（左滑下一首，右滑上一首）。
  // 只记录 touchStart 的起点，touchMove 不更新，否则 delta 会被最后一段位移稀释。
  const rowSwipeRef = useRef<{ x: number; y: number } | null>(null);
  // 浏览器在 touchend 后仍会在滑动终点触发 click，用这个标记吞掉它，避免"滑动 + 点击"双重动作
  const rowSwipeHandledRef = useRef(false);
  const handleRowSwipeEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = rowSwipeRef.current;
    rowSwipeRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    if (Math.abs(dx) < 60) return;
    rowSwipeHandledRef.current = true;
    if (dx < 0) onNextTrack?.();
    else onPrevTrack?.();
  };

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col gap-4">
      {/* 工具栏: 窄屏一行装下 tabs + 搜索 + 筛选菜单（媒体类型收进菜单），
          桌面仍是 tabs / 搜索 / 类型 / 菜单 同一行 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Navigation Tabs — 图标-only（文字在手机上会把工具栏挤成多行），数量在 title 里 */}
        <div className="flex items-center gap-1 p-1 bg-surface rounded-xl border border-line shrink-0">
          <button
            onClick={() => setActiveTab('tracks')}
            title={t('曲目 {loaded}/{total}', { loaded: fmtNum(tracks.length), total: fmtNum(totalTracks) })}
            aria-label={t('曲目')}
            className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
              activeTab === 'tracks'
                ? 'bg-surface-2 text-ink shadow-sm'
                : 'text-muted hover:text-ink-2'
            }`}
          >
            <ListMusic className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTab('artists')}
            title={t('歌手 {n}', { n: fmtNum(artists.length) })}
            aria-label={t('歌手')}
            className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
              activeTab === 'artists'
                ? 'bg-surface-2 text-ink shadow-sm'
                : 'text-muted hover:text-ink-2'
            }`}
          >
            <User className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTab('albums')}
            title={t('专辑 {n}', { n: fmtNum(albums.length) })}
            aria-label={t('专辑')}
            className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
              activeTab === 'albums'
                ? 'bg-surface-2 text-ink shadow-sm'
                : 'text-muted hover:text-ink-2'
            }`}
          >
            <Disc className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            title={t('收藏 {n}', { n: fmtNum(favorites.length) })}
            aria-label={t('收藏')}
            className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
              activeTab === 'favorites'
                ? 'bg-surface-2 text-accent-soft shadow-sm border border-accent/30'
                : 'text-muted hover:text-accent-soft'
            }`}
          >
            <Heart className={`w-4 h-4 ${favorites.length > 0 ? 'fill-accent text-accent' : ''}`} />
          </button>
        </div>

        {/* Search & Filter — 允许换行, 窄屏不至于挤成一条溢出 */}
        <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
          {/* Search box — 占据剩余宽度，搜索框更长更容易读长查询。窄屏下限更小，
              否则 tabs + 搜索 + 筛选按钮刚好超过一行会换行 */}
          <div className={`relative flex-1 ${isCompact ? 'min-w-[96px]' : 'min-w-[120px]'}`}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-2" />
            <input
              type="text"
              placeholder={t('搜索曲目、歌手或专辑...')}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-surface border border-line text-sm text-ink-2 placeholder-muted-2 focus:outline-none focus:border-accent/80 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-2 hover:text-ink-3"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 搜索命中数: 防抖后服务端返回的总数 */}
          {searchQuery && (
            <span className="text-[11px] font-mono text-muted-2 shrink-0">{t('命中 {n}', { n: totalTracks })}</span>
          )}

          {/* Media Type Toggle — 图标-only（全部 / MTV / 音乐），文字在 title 里。
              窄屏收进「筛选与工具」菜单，保证工具栏一行装下 */}
          {!isCompact && (
          <div className="flex items-center gap-1 p-1 bg-surface rounded-xl border border-line shrink-0">
            <button
              onClick={() => onFilterMediaType('all')}
              title={t('全部类型')}
              aria-label={t('全部')}
              className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
                mediaTypeFilter === 'all'
                  ? 'bg-surface-2 text-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>
            <button
              onClick={() => onFilterMediaType('video')}
              title={t('只看 MTV / 视频')}
              aria-label="MTV"
              className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
                mediaTypeFilter === 'video'
                  ? 'bg-accent-dim/80 text-accent-soft border border-accent-dim/60'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Film className="w-4 h-4" />
            </button>
            <button
              onClick={() => onFilterMediaType('audio')}
              title={t('只看音乐 / 音频')}
              aria-label={t('音乐')}
              className={`${isCompact ? 'p-1.5' : 'p-2'} rounded-lg transition-colors ${
                mediaTypeFilter === 'audio'
                  ? 'bg-accent-dim/80 text-accent-soft border border-accent-dim/60'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Music className="w-4 h-4" />
            </button>
          </div>
          )}

          {/* 「筛选与工具」下拉：只看已转码 / 只看有歌词 / 预取封面 / 预取歌词 / 行密度
              收进一个菜单，工具栏不再换行（窄屏尤其重要） */}
          <div ref={toolMenuRef} className="relative shrink-0">
            <button
              onClick={() => setToolMenuOpen((v) => !v)}
              title={t('筛选与工具：只看已转码 / 只看有歌词 / 预取封面 / 预取歌词 / 行密度')}
              aria-label={t('筛选与工具')}
              className={`rounded-lg border transition-colors flex items-center gap-1.5 ${
                isCompact ? 'p-1.5' : 'p-2'
              } ${
                toolMenuOpen
                  ? 'bg-surface-2 text-ink border-line-strong'
                  : 'bg-surface text-muted border-line hover:text-ink'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {isCompact && mediaTypeFilter !== 'all' && (
                <span title={mediaTypeFilter === 'video' ? t('只看 MTV / 视频') : t('只看音乐 / 音频')} className="flex items-center">
                  {mediaTypeFilter === 'video' ? <Film className="w-3.5 h-3.5 text-accent-soft" /> : <Music className="w-3.5 h-3.5 text-accent-soft" />}
                </span>
              )}
              {(readyOnly || hasLyricsOnly) && (
                <span className="flex items-center gap-1">
                  {readyOnly && (
                    <span title={t('已转码')} className="flex items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald" />
                    </span>
                  )}
                  {hasLyricsOnly && (
                    <span title={t('有歌词')} className="flex items-center">
                      <Captions className="w-3.5 h-3.5 text-sky" />
                    </span>
                  )}
                </span>
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${toolMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {toolMenuOpen && (
              <div className="absolute top-full right-0 z-40 mt-2 w-[360px] max-w-[92vw] p-3 rounded-xl bg-surface border border-line shadow-xl shadow-black/60">
                {/* 窄屏: 媒体类型收进菜单（工具栏一行装不下 tabs + 搜索 + 类型 + 菜单） */}
                {isCompact && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <span className="text-[11px] text-muted-2">{t('媒体类型')}</span>
                    <button
                      onClick={() => onFilterMediaType('all')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                        mediaTypeFilter === 'all' ? 'bg-surface-2 text-ink border-line-strong' : 'bg-surface text-muted border-line hover:text-ink'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{t('全部')}</span>
                    </button>
                    <button
                      onClick={() => onFilterMediaType('video')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                        mediaTypeFilter === 'video' ? 'bg-accent-dim/80 text-accent-soft border-accent-dim/60' : 'bg-surface text-muted border-line hover:text-ink'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>{t('MTV')}</span>
                    </button>
                    <button
                      onClick={() => onFilterMediaType('audio')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                        mediaTypeFilter === 'audio' ? 'bg-accent-dim/80 text-accent-soft border-accent-dim/60' : 'bg-surface text-muted border-line hover:text-ink'
                      }`}
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span>{t('音乐')}</span>
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {onToggleReadyOnly && (
                    <button
                      onClick={onToggleReadyOnly}
                      title={t('只显示已转码(或无需转码)的曲目；排队中和转码中的 .mkv 会被隐藏')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                        readyOnly
                          ? 'bg-emerald-dim/70 text-emerald border-emerald-dim/60'
                          : 'bg-surface text-muted border-line hover:text-ink'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('只看已转码')}</span>
                    </button>
                  )}
                  {onToggleHasLyrics && (
                    <button
                      onClick={onToggleHasLyrics}
                      title={t('只显示网易云有歌词的曲目（筛选只读服务端歌词缓存，先预取覆盖率更高）')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                        hasLyricsOnly
                          ? 'bg-sky-dim/70 text-sky border-sky-dim/60'
                          : 'bg-surface text-muted border-line hover:text-ink'
                        }`}
                    >
                      <Captions className="w-3.5 h-3.5" />
                      <span>{t('只看有歌词')}</span>
                    </button>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {onSortChange && (
                    <select
                      value={sort}
                      onChange={(e) => onSortChange(e.target.value as TrackSort)}
                      title={t('列表排序（服务端 /api/tracks 的 sort 参数，默认 = 扫描索引顺序）')}
                      className="px-2.5 py-1.5 text-xs rounded-lg bg-surface border border-line text-ink-3 hover:text-ink cursor-pointer"
                    >
                      <option value="default">{t('默认顺序')}</option>
                      <option value="title">{t('标题 A→Z')}</option>
                      <option value="artist">{t('歌手 A→Z')}</option>
                      <option value="album">{t('专辑 A→Z')}</option>
                      <option value="duration">{t('时长')}</option>
                      <option value="size">{t('文件大小')}</option>
                      <option value="mtime">{t('文件日期')}</option>
                      <option value="random">{t('随机')}</option>
                    </select>
                  )}
                  {onToggleDensity && (
                    <button
                      onClick={onToggleDensity}
                      title={rowDensity === 'compact' ? t('当前紧凑模式，点击恢复标准行高') : t('当前标准模式，点击切换紧凑行高（紧凑隐藏专辑列，每屏多几行）')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                        rowDensity === 'compact'
                          ? 'bg-surface-2 text-ink border-line-strong'
                          : 'bg-surface text-muted border-line hover:text-ink'
                      }`}
                    >
                      {rowDensity === 'compact' ? t('紧凑行高') : t('标准行高')}
                    </button>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={handlePrefetchCovers}
                    title={t('为当前列表条目获取封面（每次最多 200 条）：优先本地内嵌封面，其次 iTunes / 网易云')}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                      coverPrefetching
                        ? 'bg-accent-dim/70 text-accent-soft border-accent-dim/60'
                        : 'bg-surface text-muted border-line hover:text-ink'
                    }`}
                  >
                    {coverPrefetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Disc className="w-3.5 h-3.5" />}
                    <span>{coverPrefetching ? t('获取封面…') : t('预取封面')}</span>
                  </button>
                  <button
                    onClick={handlePrefetchLyrics}
                    title={t('为当前列表条目获取歌词（网易云，每次最多 200 条），缓存到 fastmusic_lyrics.json；「只看有歌词」也依赖这份缓存')}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                      lyricPrefetching
                        ? 'bg-sky-dim/70 text-sky border-sky-dim/60'
                        : 'bg-surface text-muted border-line hover:text-ink'
                    }`}
                  >
                    {lyricPrefetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Captions className="w-3.5 h-3.5" />}
                    <span>{lyricPrefetching ? t('获取歌词…') : t('预取歌词')}</span>
                  </button>
                </div>
                {(coverPrefetchInfo || lyricPrefetchInfo) && (
                  <p className="mt-2 text-[11px] text-muted-2 leading-relaxed">
                    {coverPrefetchInfo && <span>{coverPrefetchInfo}</span>}
                    {coverPrefetchInfo && lyricPrefetchInfo && <span className="mx-1.5">·</span>}
                    {lyricPrefetchInfo && <span>{lyricPrefetchInfo}</span>}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* A-Z Alphabet quick navigation for Artists / Albums */}
      {(activeTab === 'artists' || activeTab === 'albums') && (
        <div className={`flex items-center gap-1 overflow-x-auto py-1 px-2 bg-surface/40 rounded-xl border border-line/80 ${NO_SCROLLBAR_CLASSES}`}>
          <span className="hidden sm:inline text-[11px] text-muted-2 px-1 font-mono">{t('字母索引:')}</span>
          {alphabet.map((char) => (
            <button
              key={char}
              onClick={() => setLetterFilter(char)}
              className={`px-2 ${isCompact ? 'py-1' : 'py-0.5'} rounded text-[11px] font-mono transition-colors shrink-0 ${
                letterFilter === char
                  ? 'bg-accent text-white font-bold'
                  : 'text-muted hover:text-ink hover:bg-surface-2'
              }`}
            >
              {char}
            </button>
          ))}
        </div>
      )}

      {/* Active Filter Bar (when filtering by artist or album) */}
      {(selectedArtist || selectedAlbum) && (
        <div className="flex items-center gap-2 p-2.5 bg-surface/60 rounded-xl border border-line text-xs text-ink-3">
          <SlidersHorizontal className="w-3.5 h-3.5 text-accent" />
          <span>{t('正在筛选:')}</span>
          {selectedArtist && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 text-ink">
              {t('歌手: {name}', { name: selectedArtist })}
              <button
                onClick={() => onFilterArtist(null)}
                className="hover:text-accent ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {selectedAlbum && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 text-ink">
              {t('专辑: {name}', { name: selectedAlbum })}
              <button
                onClick={() => onFilterAlbum(null)}
                className="hover:text-accent ml-1"
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
            className="text-muted-2 hover:text-ink-3 ml-auto text-xs underline"
          >
            {t('清除所有筛选')}
          </button>
        </div>
      )}

      {/* Tab 1: Tracks List with Infinite Scroll (触底自动追加) */}
      {activeTab === 'tracks' && (
        <div className="w-full flex-1 min-h-0 bg-surface/40 rounded-2xl border border-line/80 overflow-hidden flex flex-col">
          {totalTracks === 0 ? (
            <div className="p-12 text-center text-muted-2 flex flex-col items-center">
              <Music className="w-12 h-12 stroke-1 text-faint mb-3" />
              <p className="text-base font-medium text-ink-3">{t('暂无匹配的媒体文件')}</p>
              <p className="text-xs text-muted-2 mt-1 max-w-sm">
                {t('未在当前筛选中找到曲目。您可以重置筛选，或在「系统配置」里添加扫描目录并重新扫描。')}
              </p>
              <button
                onClick={onScanClick}
                className="mt-4 px-4 py-2 bg-accent hover:bg-accent text-white text-xs font-medium rounded-xl transition-colors"
              >
                {t('打开系统配置 · 扫描目录')}
              </button>
            </div>
          ) : (
            <>
              {/* Scrollable list box: 高度由 main 的剩余空间决定（有下限，避免行被压扁），
                  这样小屏不会把列表裁掉, 页脚始终可见 */}
              <div ref={scrollBoxRef} onScroll={handleScrollBox} className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}>
              {/* Header row with performance indicator — pinned while the rows scroll */}
              <div className={`sticky top-0 z-10 hidden sm:grid grid-cols-12 gap-4 px-5 ${rowDensity === 'compact' ? 'py-2' : 'py-3'} text-[11px] font-semibold text-muted tracking-wider uppercase bg-surface/70 border-b border-line/60`}>
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">{t('曲目标题 / 艺术家')}</div>
                {rowDensity === 'compact' ? (
                  <div className="col-span-3 text-center">{t('时长')}</div>
                ) : (
                  <div className="col-span-3">{t('所属专辑')}</div>
                )}
                <div className="col-span-1 text-center">{t('格式')}</div>
                <div className="col-span-2 text-right">{t('大小 / 操作')}</div>
              </div>

              {/* Rows List */}
              <div className="divide-y divide-line/60">
                {tracks.map((track, idx) => {
                  const isCurrent = track.id === currentTrackId;
                  const isVideo = track.media_type === 'video';
                  const isFavorited = favoriteIds.has(track.id);

                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`grid grid-cols-12 gap-2 sm:gap-4 px-4 sm:px-5 ${rowDensity === 'compact' ? 'py-1.5' : 'py-3'} items-center text-xs transition-colors group cursor-pointer relative ${
                        isCurrent
                          ? 'bg-accent-dim/40 text-accent-soft font-medium border-l-2 border-l-accent'
                          : isFavorited
                          ? 'bg-accent-dim/20 hover:bg-accent-dim/35 text-ink border-l-2 border-l-accent/80 shadow-inner'
                          : 'hover:bg-surface-2/50 text-ink-3'
                      }`}
                      onClick={() => {
                        if (rowSwipeHandledRef.current) { rowSwipeHandledRef.current = false; return; }
                        onSelectTrack(track);
                      }}
                      onTouchStart={(e) => { rowSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                      onTouchEnd={handleRowSwipeEnd}
                    >
                      {/* Index / Play icon */}
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-center">
                        {isCurrent ? (
                          <div className="flex items-center gap-0.5">
                            <span className="w-1 h-3 bg-accent rounded-full animate-bounce" />
                            <span className="w-1 h-4 bg-accent rounded-full animate-bounce [animation-delay:0.15s]" />
                            <span className="w-1 h-2.5 bg-accent rounded-full animate-bounce [animation-delay:0.3s]" />
                          </div>
                        ) : (
                          <span className="font-mono text-muted-2 group-hover:hidden tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        )}
                        {!isCurrent && (
                          <Play className="w-3.5 h-3.5 text-accent hidden group-hover:block" />
                        )}
                      </div>

                      {/* Title and Artist */}
                      <div className="col-span-8 sm:col-span-5 flex items-center gap-3 min-w-0">
                        <div className={`${rowDensity === 'compact' ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg bg-surface-2 border border-line-strong/80 flex items-center justify-center shrink-0 overflow-hidden relative`} style={coverOf(track) ? undefined : { background: coverGradient(track.title) }}>
                          {coverOf(track) ? (
                            <img
                              src={coverOf(track)}
                              alt={track.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : isVideo ? (
                            <Film className="w-4 h-4 text-accent" />
                          ) : (
                            <Music className="w-4 h-4 text-muted" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`truncate font-medium ${isCurrent ? 'text-accent-soft' : isFavorited ? 'text-ink' : 'text-ink group-hover:text-ink'}`}>
                              {track.title}
                            </div>
                            {isFavorited && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent border border-accent/30 shrink-0">
                                <Heart className="w-2.5 h-2.5 fill-accent text-accent" />
                                <span>{t('已收藏')}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted truncate flex items-center gap-1.5 mt-0.5">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onFilterArtist(track.artist);
                              }}
                              className="hover:text-accent hover:underline"
                            >
                              {t(track.artist)}
                            </span>
                            {rowDensity === 'comfortable' && formatDuration(track.duration) && (
                              <span aria-hidden="true" className="text-faint">·</span>
                            )}
                            {rowDensity === 'comfortable' && formatDuration(track.duration) && (
                              <span className="font-mono tabular-nums text-muted-2">{formatDuration(track.duration)}</span>
                            )}
                            {track.lyric === 'yes' && (
                              <span title={t('有歌词（网易云歌词缓存）')} className="shrink-0">
                                <Captions className="w-3 h-3 text-accent" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 专辑（标准模式） / 时长（紧凑模式） */}
                      {rowDensity === 'compact' ? (
                        <div className="hidden sm:flex sm:col-span-3 items-center justify-center font-mono text-[11px] text-muted-2 tabular-nums">
                          {formatDuration(track.duration) || '—'}
                        </div>
                      ) : (
                        <div className="hidden sm:block sm:col-span-3 text-muted truncate">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onFilterAlbum(track.album);
                            }}
                            className="hover:text-ink-2 hover:underline"
                          >
                            {t(track.album)}
                          </span>
                        </div>
                      )}

                      {/* Type badge */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center">
                        <span
                          className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                            isVideo
                              ? 'bg-accent-dim/30 text-accent-soft border border-accent-dim/40'
                              : 'bg-surface-2 text-muted border border-line-strong/50'
                          }`}
                        >
                          {track.ext.replace('.', '').toUpperCase()}
                        </span>
                      </div>

                      {/* Size and Quick Action */}
                      <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1.5 sm:gap-2 text-right">
                        <span className="hidden md:inline font-mono text-[11px] text-muted-2 tabular-nums">
                          {formatFileSize(track.file_size)}
                        </span>

                        {transcodeBadge(track)}

                        {onToggleFavorite && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(track);
                            }}
                            title={isFavorited ? t('取消收藏') : t('添加至收藏')}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              isFavorited
                                ? 'text-accent hover:text-accent opacity-100'
                                : 'text-muted-2 hover:text-accent opacity-0 group-hover:opacity-100 focus:opacity-100'
                            }`}
                          >
                            <Heart className={`w-4 h-4 transition-transform active:scale-125 ${isFavorited ? 'fill-accent text-accent' : ''}`} />
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
              </div>

              {/* ================= FOOTER (stays visible below the scroll box) ================= */}
              <div className="px-4 py-2.5 bg-surface/80 border-t border-line/60 flex items-center justify-between gap-3 text-xs text-muted">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-accent font-medium">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{t('正在拉取下一批曲目 (offset={offset})...', { offset: tracks.length })}</span>
                    </div>
                  ) : hasMore ? (
                    <span className="text-muted">
                      {t('已加载')} <strong className="text-ink font-mono">{tracks.length}</strong> / <strong className="text-accent font-mono">{totalTracks}</strong> {t('首 · 向下滚动自动追加')}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted">
                      <CheckCircle2 className="w-4 h-4 text-emerald" />
                      <span>{t('已加载全部')} <strong className="text-ink-2 font-mono">{totalTracks}</strong> {t('首')}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const el = scrollBoxRef.current;
                    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  title={t('回到列表顶部')}
                  aria-label={t('回到顶部')}
                  className="p-2 rounded-lg bg-surface-2 hover:bg-elevated text-ink-3 hover:text-ink transition-colors shrink-0 cursor-pointer"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Artists Grid — 独立滚动容器 + 分批渲染，卡片多时也能向下浏览 */}
      {activeTab === 'artists' && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted">
            <span>
              {t('共收录')} <strong className="text-ink">{filteredArtists.length}</strong> {t('位艺术家 / UP主')}
              <span className="ml-2 font-mono text-muted-2">· {t('已渲染 {n}', { n: Math.min(artistLimit, filteredArtists.length) })}</span>
              {entityCoverInfo && <span className="ml-2 text-muted-2">{entityCoverInfo}</span>}
            </span>
            <select
              value={entitySort}
              onChange={(e) => setEntitySort(e.target.value as 'name' | 'count')}
              className="px-2 py-1 rounded-lg bg-surface border border-line text-xs text-ink-3 cursor-pointer"
            >
              <option value="name">{t('按名称')}</option>
              <option value="count">{t('按作品数')}</option>
            </select>
          </div>
          <div
            ref={gridBoxRef}
            onScroll={handleGridScroll}
            className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}
          >
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${isCompact ? 'gap-2' : 'gap-4'}`}>
              {filteredArtists.slice(0, artistLimit).map((artist) => (
                <div
                  key={t(artist.artist_name)}
                  onClick={() => {
                    onFilterArtist(artist.artist_name);
                    setActiveTab('tracks');
                  }}
                  className={`${isCompact ? 'p-3' : 'p-4'} rounded-2xl bg-surface/60 border border-line/80 hover:border-accent/50 hover:bg-surface-2/40 transition-all cursor-pointer group flex flex-col items-center text-center`}
                >
                  <div className={`${isCompact ? 'w-16 h-16 mb-2' : 'w-20 h-20 sm:w-24 sm:h-24 mb-3'} rounded-full overflow-hidden bg-surface-2 border-2 border-line-strong group-hover:border-accent/80 transition-colors shadow-lg flex items-center justify-center`}>
                    {entityCover(artist) ? (
                      <img
                        src={entityCover(artist)}
                        alt={t(artist.artist_name)}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <User className="w-8 h-8 text-muted-2" />
                    )}
                  </div>
                  <h4 className="font-semibold text-sm text-ink group-hover:text-accent truncate w-full">
                    {t(artist.artist_name)}
                  </h4>
                  <p className="text-xs text-muted mt-1">
                    {t('{albums} 张专辑 · {tracks} 首作品', { albums: artist.album_count, tracks: artist.track_count })}
                  </p>
                </div>
              ))}
            </div>
            {artistLimit < filteredArtists.length && (
              <div className="flex justify-center mt-3">
                <button
                  onClick={() => setArtistLimit((n) => n + 120)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink-3 hover:text-ink hover:border-accent/50 transition-colors cursor-pointer"
                >
                  {t('加载更多 ({n})', { n: filteredArtists.length - artistLimit })}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Albums Grid — 同样独立滚动 + 分批渲染 */}
      {activeTab === 'albums' && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted">
            <span>
              {t('共收录')} <strong className="text-ink">{filteredAlbums.length}</strong> {t('张专辑')}
              <span className="ml-2 font-mono text-muted-2">· {t('已渲染 {n}', { n: Math.min(albumLimit, filteredAlbums.length) })}</span>
              {entityCoverInfo && <span className="ml-2 text-muted-2">{entityCoverInfo}</span>}
            </span>
            <select
              value={entitySort}
              onChange={(e) => setEntitySort(e.target.value as 'name' | 'count')}
              className="px-2 py-1 rounded-lg bg-surface border border-line text-xs text-ink-3 cursor-pointer"
            >
              <option value="name">{t('按名称')}</option>
              <option value="count">{t('按曲目数')}</option>
            </select>
          </div>
          <div
            ref={gridBoxRef}
            onScroll={handleGridScroll}
            className={`overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}
          >
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${isCompact ? 'gap-2' : 'gap-4'}`}>
              {filteredAlbums.slice(0, albumLimit).map((album) => (
                <div
                  key={`${t(album.artist_name)}-${t(album.album_name)}`}
                  onClick={() => {
                    onFilterAlbum(album.album_name);
                    setActiveTab('tracks');
                  }}
                  className="p-3 rounded-2xl bg-surface/60 border border-line/80 hover:border-accent/50 hover:bg-surface-2/40 transition-all cursor-pointer group flex flex-col"
                >
                  <div className="aspect-square w-full rounded-xl overflow-hidden bg-surface-2 border border-line-strong/80 group-hover:border-accent/80 transition-colors shadow-lg mb-3 flex items-center justify-center">
                    {entityCover(album) ? (
                      <img
                        src={entityCover(album)}
                        alt={t(album.album_name)}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-muted-2" />
                    )}
                  </div>
                  <h4 className="font-semibold text-xs text-ink group-hover:text-accent truncate">
                    {t(album.album_name)}
                  </h4>
                  <p className="text-[11px] text-muted truncate mt-0.5">
                    {t(album.artist_name)}
                  </p>
                  <p className="text-[10px] text-muted-2 mt-1 font-mono">
                    {t('{n} 首曲目', { n: album.track_count })}
                  </p>
                </div>
              ))}
            </div>
            {albumLimit < filteredAlbums.length && (
              <div className="flex justify-center mt-3">
                <button
                  onClick={() => setAlbumLimit((n) => n + 120)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink-3 hover:text-ink hover:border-accent/50 transition-colors cursor-pointer"
                >
                  {t('加载更多 ({n})', { n: filteredAlbums.length - albumLimit })}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Favorites List */}
      {activeTab === 'favorites' && (
        <div className="w-full flex-1 min-h-0 bg-surface/40 rounded-2xl border border-line/80 overflow-hidden flex flex-col">
          {favorites.length === 0 ? (
            <div className="p-12 text-center text-muted-2 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-accent-dim/30 border border-accent-dim/40 flex items-center justify-center text-accent mb-3 shadow-inner">
                <Heart className="w-8 h-8" />
              </div>
              <p className="text-base font-medium text-ink-2">{t('暂无收藏的曲目')}</p>
              <p className="text-xs text-muted mt-1.5 max-w-sm leading-relaxed">
                {t('在播放卡片区域或曲目列表中点击心形爱心 (Heart) 按钮，即可将喜爱的无损音乐与高清 MTV 保存到此处。')}
              </p>
              <button
                onClick={() => setActiveTab('tracks')}
                className="mt-5 px-4 py-2 bg-accent hover:bg-accent text-white text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-md"
              >
                {t('浏览全部曲目')}
              </button>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="hidden sm:grid grid-cols-12 gap-4 px-5 py-3 text-[11px] font-semibold text-muted tracking-wider uppercase bg-surface/70 border-b border-line/60">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">{t('曲目标题 / 艺术家')}</div>
                <div className="col-span-3">{t('所属专辑')}</div>
                <div className="col-span-1 text-center">{t('格式')}</div>
                <div className="col-span-2 text-right">{t('大小 / 操作')}</div>
              </div>

              {/* Rows List — 高度由 main 的剩余空间决定（有下限，避免行被压扁），页脚始终可见 */}
              <div className={`divide-y divide-line/60 overflow-y-auto flex-1 min-h-[140px] ${SCROLLBAR_CLASSES}`}>
                {favorites.map((track, idx) => {
                  const isCurrent = track.id === currentTrackId;
                  const isVideo = track.media_type === 'video';

                  return (
                    <div
                      key={`fav-${track.id}-${idx}`}
                      className={`grid grid-cols-12 gap-2 sm:gap-4 px-4 sm:px-5 py-3 items-center text-xs transition-colors group cursor-pointer relative ${
                        isCurrent
                          ? 'bg-accent-dim/40 text-accent-soft font-medium border-l-2 border-l-accent'
                          : 'bg-accent-dim/15 hover:bg-accent-dim/30 text-ink border-l-2 border-l-accent/80 shadow-inner'
                      }`}
                      onClick={() => {
                        if (rowSwipeHandledRef.current) { rowSwipeHandledRef.current = false; return; }
                        onSelectTrack(track);
                      }}
                      onTouchStart={(e) => { rowSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                      onTouchEnd={handleRowSwipeEnd}
                    >
                      {/* Index / Play icon */}
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-center">
                        {isCurrent ? (
                          <div className="flex items-center gap-0.5">
                            <span className="w-1 h-3 bg-accent rounded-full animate-bounce" />
                            <span className="w-1 h-4 bg-accent rounded-full animate-bounce [animation-delay:0.15s]" />
                            <span className="w-1 h-2.5 bg-accent rounded-full animate-bounce [animation-delay:0.3s]" />
                          </div>
                        ) : (
                          <span className="font-mono text-muted-2 group-hover:hidden tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        )}
                        {!isCurrent && (
                          <Play className="w-3.5 h-3.5 text-accent hidden group-hover:block" />
                        )}
                      </div>

                      {/* Title and Artist */}
                      <div className="col-span-8 sm:col-span-5 flex items-center gap-3 min-w-0">
                        <div className={`${rowDensity === 'compact' ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg bg-surface-2 border border-line-strong/80 flex items-center justify-center shrink-0 overflow-hidden relative`} style={coverOf(track) ? undefined : { background: coverGradient(track.title) }}>
                          {coverOf(track) ? (
                            <img
                              src={coverOf(track)}
                              alt={track.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : isVideo ? (
                            <Film className="w-4 h-4 text-accent" />
                          ) : (
                            <Music className="w-4 h-4 text-muted" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="truncate font-medium text-ink">
                              {track.title}
                            </div>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent border border-accent/30 shrink-0">
                              <Heart className="w-2.5 h-2.5 fill-accent text-accent" />
                              <span>{t('已收藏')}</span>
                            </span>
                          </div>
                          <div className="text-[11px] text-muted truncate flex items-center gap-1.5 mt-0.5">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onFilterArtist(track.artist);
                                setActiveTab('tracks');
                              }}
                              className="hover:text-accent hover:underline"
                            >
                              {t(track.artist)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Album */}
                      <div className="hidden sm:block sm:col-span-3 text-muted truncate">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onFilterAlbum(track.album);
                            setActiveTab('tracks');
                          }}
                          className="hover:text-ink-2 hover:underline"
                        >
                          {t(track.album)}
                        </span>
                      </div>

                      {/* Type badge */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center">
                        <span
                          className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                            isVideo
                              ? 'bg-accent-dim/30 text-accent-soft border border-accent-dim/40'
                              : 'bg-surface-2 text-muted border border-line-strong/50'
                          }`}
                        >
                          {track.ext.replace('.', '').toUpperCase()}
                        </span>
                      </div>

                      {/* Size and Quick Action */}
                      <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1.5 sm:gap-2 text-right">
                        <span className="hidden md:inline font-mono text-[11px] text-muted-2 tabular-nums">
                          {formatFileSize(track.file_size)}
                        </span>

                        {transcodeBadge(track)}

                        {onToggleFavorite && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(track);
                            }}
                            title={t('取消收藏')}
                            className="p-1.5 rounded-lg text-accent hover:text-accent transition-colors cursor-pointer"
                          >
                            <Heart className="w-4 h-4 fill-accent text-accent" />
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer info */}
              <div className="p-3 bg-surface/70 border-t border-line/60 text-center text-xs text-muted">
                {t('已在本地收藏')} <strong className="text-accent font-mono">{favorites.length}</strong> {t("首曲目 (存储于 localStorage 'favorites')")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
