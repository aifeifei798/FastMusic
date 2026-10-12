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
  Radio,
  Heart,
  Loader2,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, TranscodeInfo, TranscodeSummary } from '../types/media';
import { mediaApi } from '../services/api';

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
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onStartRadio?: () => void;
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
  searchQuery,
  onSearchChange,
  onStartRadio,
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

  // Filtered artists by A-Z letter
  const filteredArtists = useMemo(() => {
    if (letterFilter === 'ALL') return artists;
    return artists.filter(a => {
      const firstChar = a.artist_name.trim().charAt(0).toUpperCase();
      if (letterFilter === '#') {
        return !/[A-Z]/.test(firstChar);
      }
      return firstChar === letterFilter;
    });
  }, [artists, letterFilter]);

  // Filtered albums by A-Z letter
  const filteredAlbums = useMemo(() => {
    if (letterFilter === 'ALL') return albums;
    return albums.filter(a => {
      const firstChar = a.album_name.trim().charAt(0).toUpperCase();
      if (letterFilter === '#') {
        return !/[A-Z]/.test(firstChar);
      }
      return firstChar === letterFilter;
    });
  }, [albums, letterFilter]);

  const alphabet = ['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'];

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col gap-4">
      {/* Search & Top Action Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 p-1 bg-neutral-900 rounded-xl border border-neutral-800">
          <button
            onClick={() => setActiveTab('tracks')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'tracks'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            曲目 ({tracks.length} / {totalTracks})
          </button>
          <button
            onClick={() => setActiveTab('artists')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'artists'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            歌手 / UP主 ({artists.length})
          </button>
          <button
            onClick={() => setActiveTab('albums')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'albums'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            专辑库 ({albums.length})
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'favorites'
                ? 'bg-neutral-800 text-rose-300 shadow-sm border border-rose-500/30'
                : 'text-neutral-400 hover:text-rose-300'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorites.length > 0 ? 'fill-rose-500 text-rose-500' : 'text-neutral-400'}`} />
            <span>我的收藏 ({favorites.length})</span>
          </button>
          {onStartRadio && (
            <button
              onClick={onStartRadio}
              title="进入随心电台，立即随机播放全库"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white transition-all shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer ml-1"
            >
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>随心电台</span>
            </button>
          )}
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-2 flex-1 max-w-xl justify-end">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="搜索曲目、歌手或专辑..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-rose-500/80 transition-colors"
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
        <div className="flex items-center gap-1 overflow-x-auto py-1 px-2 bg-neutral-900/40 rounded-xl border border-neutral-800/80 scrollbar-none">
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
              {/* Scrollable list box: rows scroll internally (bounded height) so the page footer stays visible */}
              <div ref={scrollBoxRef} onScroll={handleScrollBox} className="overflow-y-auto h-[390px]">
              {/* Header row with performance indicator — pinned while the rows scroll */}
              <div className="sticky top-0 z-10 hidden sm:grid grid-cols-12 gap-4 px-5 py-3 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase bg-neutral-900/70 border-b border-neutral-800/60">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">曲目标题 / 艺术家</div>
                <div className="col-span-3">所属专辑</div>
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
                      className={`grid grid-cols-12 gap-2 sm:gap-4 px-4 sm:px-5 py-3 items-center text-xs transition-colors group cursor-pointer relative ${
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
                        <div className="w-9 h-9 rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 overflow-hidden relative">
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
                          </div>
                        </div>
                      </div>

                      {/* Album */}
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
              <div className="p-4 bg-neutral-900/80 border-t border-neutral-800/60 flex flex-col items-center justify-center gap-2 text-xs text-neutral-400">
                {isLoadingMore ? (
                  <div className="flex items-center gap-2 py-2 text-rose-400 font-medium">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>正在流式拉取下一批曲目 (limit=30, offset={tracks.length})...</span>
                  </div>
                ) : hasMore ? (
                  <span className="text-neutral-400">
                    已加载 <strong className="text-white font-mono">{tracks.length}</strong> / <strong className="text-rose-400 font-mono">{totalTracks}</strong> 首曲目 · 向下滚动自动追加
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5 text-neutral-400 py-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>已加载完毕全部 <strong className="text-neutral-200 font-mono">{totalTracks}</strong> 首曲目，无更多数据</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Artists Grid */}
      {activeTab === 'artists' && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-neutral-400">
            共收录 <strong className="text-white">{filteredArtists.length}</strong> 位艺术家 / UP主
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredArtists.map((artist) => (
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
        </div>
      )}

      {/* Tab 3: Albums Grid */}
      {activeTab === 'albums' && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-neutral-400">
            共收录 <strong className="text-white">{filteredAlbums.length}</strong> 张专辑
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredAlbums.map((album) => (
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

              {/* Rows List — bounded height, scrolls internally so the footer stays visible */}
              <div className="divide-y divide-neutral-800/60 overflow-y-auto h-[390px]">
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
                        <div className="w-9 h-9 rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 overflow-hidden relative">
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
