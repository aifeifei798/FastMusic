import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Tv, 
  Server, 
  RefreshCw, 
  Radio, 
  History,
  Keyboard,
  Sparkles,
  Heart
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, PlayMode, PlayHistoryItem, RadioChannel, TrackSort } from './types/media';
import { mediaApi } from './services/api';
import { VideoJsPlayer } from './components/VideoJsPlayer';
import { LibraryView } from './components/LibraryView';
import { ServerConfigModal } from './components/ServerConfigModal';
import { PlayHistoryModal } from './components/PlayHistoryModal';
import { RadioStationBanner } from './components/RadioStationBanner';

export default function App() {
  // Media library state
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const [totalTracks, setTotalTracks] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Play history state (stored in localStorage)
  const [history, setHistory] = useState<PlayHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('media_play_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Favorites state (saved to localStorage under 'favorites')
  const [favorites, setFavorites] = useState<MediaItem[]>(() => {
    try {
      const saved = localStorage.getItem('favorites');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [libraryActiveTab, setLibraryActiveTab] = useState<'tracks' | 'artists' | 'albums' | 'favorites'>('tracks');

  // Filter state
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'audio' | 'video'>('all');
  // 搜索: searchInput 是输入框里的即时文本, searchQuery 是防抖后真正用于请求的文本
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // 列表排序键（持久化）
  const [sort, setSort] = useState<TrackSort>(() => {
    try {
      const s = localStorage.getItem('fastmusic_sort');
      return (s as TrackSort) || 'default';
    } catch {
      return 'default';
    }
  });
  // 列表行密度: comfortable / compact（持久化）
  const [rowDensity, setRowDensity] = useState<'comfortable' | 'compact'>(() => {
    try { return localStorage.getItem('fastmusic_density') === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; }
  });
  // 只看"已转码/可直接播"的 .mkv（排队/转码中的隐藏）。持久化到 localStorage。
  const [readyOnly, setReadyOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('fastmusic_ready_only') === '1'; } catch { return false; }
  });
  // 只看"网易云有歌词"的曲目。筛选只读服务端歌词缓存（播放过或预取过的曲目才有状态），
  // 所以配合工具栏的「预取歌词」按钮使用效果最好。持久化到 localStorage。
  const [hasLyricsOnly, setHasLyricsOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('fastmusic_has_lyrics') === '1'; } catch { return false; }
  });

  // Player state
  // 播放序列 = 当前正在浏览的列表（曲目列表 / 收藏列表 / 电台随机池），
  // 不再有独立的"播放队列"，所以不存在"下一首到底走队列还是走列表"的二选一问题。
  const [currentTrack, setCurrentTrack] = useState<MediaItem | null>(null);
  // 当前曲目在列表中的位置；-1 表示它不在当前列表里（例如切筛选后）
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  // 随心电台的随机池（电台模式下的"列表"）
  const [radioQueue, setRadioQueue] = useState<MediaItem[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>('loop-all');
  // 是否已经选过曲目（避免切筛选时把播放区重置成列表第一条）
  const hasSelectionRef = useRef<boolean>(false);
  // 上一首/下一首的最新实现（handlePrevTrack/handleNextTrack 每次 render 都重建，
  // 全局 keydown 闭包必须通过 ref 读取最新版本）
  const prevNextRef = useRef<{ prev: () => void; next: () => void }>({ prev: () => {}, next: () => {} });
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  // Radio mode state (随心电台)
  const [isRadioMode, setIsRadioMode] = useState<boolean>(false);
  const [radioChannel, setRadioChannel] = useState<RadioChannel>('all');
  const [radioFrequency, setRadioFrequency] = useState<string>('FM 102.4 MHz');

  // Modals state
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState<boolean>(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);

  // Load Initial Library Data (First batch: limit=30, offset=0)
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [artistData, albumData, trackData] = await Promise.all([
        mediaApi.getArtists(),
        mediaApi.getAlbums(selectedArtist || undefined),
        mediaApi.getTracks({
          artist: selectedArtist || undefined,
          album: selectedAlbum || undefined,
          media_type: mediaTypeFilter === 'all' ? undefined : mediaTypeFilter,
          search: searchQuery || undefined,
          sort: sort === 'default' ? undefined : sort,
          ready_only: readyOnly || undefined,
          has_lyrics: hasLyricsOnly || undefined,
          limit: 30,
          offset: 0,
        }),
      ]);

      setArtists(artistData);
      setAlbums(albumData);
      setTracks(trackData.items);
      setTotalTracks(trackData.total);
      setHasMore(trackData.has_more);

      // 首次加载时默认选中列表第一条（不自动播放，只是让播放区有内容）
      if (!hasSelectionRef.current && trackData.items.length > 0) {
        setCurrentTrack(trackData.items[0]);
        setCurrentIndex(0);
        hasSelectionRef.current = true;
      }
    } catch (err) {
      console.error('Failed to load library data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtist, selectedAlbum, mediaTypeFilter, searchQuery, readyOnly, hasLyricsOnly, sort]);

  // Load More Tracks on scroll near bottom (limit=30, offset=currentLength)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return [];
    setIsLoadingMore(true);
    try {
      const moreData = await mediaApi.getTracks({
        artist: selectedArtist || undefined,
        album: selectedAlbum || undefined,
        media_type: mediaTypeFilter === 'all' ? undefined : mediaTypeFilter,
        search: searchQuery || undefined,
        sort: sort === 'default' ? undefined : sort,
        ready_only: readyOnly || undefined,
        has_lyrics: hasLyricsOnly || undefined,
        limit: 30,
        offset: tracks.length,
      });

      setTracks((prev) => [...prev, ...moreData.items]);
      setHasMore(moreData.has_more);
      setTotalTracks(moreData.total);
      return moreData.items;
    } catch (err) {
      console.error('Failed to load more tracks:', err);
      return [];
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, selectedArtist, selectedAlbum, mediaTypeFilter, searchQuery, readyOnly, hasLyricsOnly, sort, tracks.length]);

  // 「只看已转码」开关：持久化，切换后 loadData 依赖 readyOnly 会自动重新拉取
  const handleToggleReadyOnly = useCallback(() => {
    setReadyOnly((prev) => {
      const next = !prev;
      try { localStorage.setItem('fastmusic_ready_only', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // 「只看有歌词」开关：同样持久化，筛选走服务端歌词缓存
  const handleToggleHasLyrics = useCallback(() => {
    setHasLyricsOnly((prev) => {
      const next = !prev;
      try { localStorage.setItem('fastmusic_has_lyrics', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // 歌词预取完成后同步列表行的歌词 badge（服务端缓存已写入，避免重新拉取整页）
  const handleLyricStatus = useCallback((lyrics: Record<string, boolean>) => {
    setTracks((prev) =>
      prev.map((t) =>
        lyrics[t.id] === undefined ? t : { ...t, lyric: lyrics[t.id] ? 'yes' : 'no' }
      )
    );
  }, []);

  // 排序 / 行密度开关（都持久化）
  const handleSortChange = useCallback((next: TrackSort) => {
    setSort(next);
    try { localStorage.setItem('fastmusic_sort', next); } catch {}
  }, []);

  const handleToggleDensity = useCallback(() => {
    setRowDensity((prev) => {
      const next = prev === 'comfortable' ? 'compact' : 'comfortable';
      try { localStorage.setItem('fastmusic_density', next); } catch {}
      return next;
    });
  }, []);

  // 搜索防抖: 输入框文本 300ms 后才触发请求，避免每键一次全库扫描
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 播放序列 = 当前正在浏览的列表（曲目列表 / 收藏列表 / 电台随机池）。
  // 列表变化（切筛选、搜索、加载更多、切标签）时重新定位当前曲目在列表中的位置。
  const playlist: MediaItem[] = isRadioMode
    ? radioQueue
    : libraryActiveTab === 'favorites'
      ? favorites
      : tracks;

  useEffect(() => {
    if (!currentTrack) return;
    setCurrentIndex(playlist.findIndex((t) => t.id === currentTrack.id));
  }, [playlist, currentTrack?.id]);

  const currentStreamUrl = currentTrack ? mediaApi.getStreamUrl(currentTrack) : '';

  // Record current track to history whenever it starts playing, saving up to 100 entries in localStorage
  useEffect(() => {
    if (!currentTrack) return;
    setHistory((prev) => {
      const filtered = prev.filter((item) => item.track.id !== currentTrack.id);
      const updated = [{ track: currentTrack, playedAt: Date.now() }, ...filtered].slice(0, 100);
      try {
        localStorage.setItem('media_play_history', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save play history to localStorage', e);
      }
      return updated;
    });
  }, [currentTrack?.id]);

  const handlePlayFromHistory = (track: MediaItem) => {
    handleSelectTrack(track);
    setIsHistoryModalOpen(false);
  };

  const handleRemoveHistoryItem = (trackId: string) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.track.id !== trackId);
      try {
        localStorage.setItem('media_play_history', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem('media_play_history');
    } catch (e) {}
  };

  // Favorites lookup & toggle handler
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const handleToggleFavorite = useCallback((track: MediaItem) => {
    setFavorites((prev) => {
      const exists = prev.some((item) => item.id === track.id);
      const updated = exists
        ? prev.filter((item) => item.id !== track.id)
        : [track, ...prev];
      try {
        localStorage.setItem('favorites', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save favorites to localStorage', e);
      }
      return updated;
    });
  }, []);

  // 点击列表条目 = 从这一条开始播；"下一首/上一首"就是当前列表里的下一条/上一条
  const handleSelectTrack = (track: MediaItem) => {
    setCurrentTrack(track);
    setCurrentIndex(playlist.findIndex((t) => t.id === track.id));
    hasSelectionRef.current = true;
  };

  // Start Radio Mode: 进入电台即刻随机洗牌并自动起播
  const startRadioMode = useCallback(async (channel: RadioChannel = 'all') => {
    setIsRadioMode(true);
    setRadioChannel(channel);
    setPlayMode('shuffle');

    // 随机调谐器频率
    const randFreq = `FM ${(88 + Math.random() * 20).toFixed(1)} MHz`;
    setRadioFrequency(randFreq);

    const pick = (pool: MediaItem[]) => {
      if (pool.length === 0) return;
      const idx = Math.floor(Math.random() * pool.length);
      setRadioQueue(pool);
      setCurrentIndex(idx);
      setCurrentTrack(pool[idx]);
      hasSelectionRef.current = true;
    };

    try {
      const radioTracks = await mediaApi.getRadioTracks(channel, 50);
      if (radioTracks && radioTracks.length > 0) {
        pick(radioTracks);
      } else if (tracks.length > 0) {
        let pool = tracks;
        if (channel === 'audio') pool = tracks.filter((t) => t.media_type === 'audio');
        if (channel === 'video') pool = tracks.filter((t) => t.media_type === 'video');
        pick(pool.length > 0 ? pool : tracks);
      }
    } catch (err) {
      console.warn('Radio launch fallback', err);
      pick(tracks);
    }
  }, [tracks]);

  // 切台 / 切换电台频道 (全部 / 纯音 / MTV)
  const handleSwitchRadioChannel = async (newChannel: RadioChannel) => {
    setRadioChannel(newChannel);
    const randFreq = `FM ${(88 + Math.random() * 20).toFixed(1)} MHz`;
    setRadioFrequency(randFreq);

    try {
      const radioTracks = await mediaApi.getRadioTracks(newChannel, 50);
      if (radioTracks.length > 0) {
        const idx = Math.floor(Math.random() * radioTracks.length);
        setRadioQueue(radioTracks);
        setCurrentIndex(idx);
        setCurrentTrack(radioTracks[idx]);
      }
    } catch (err) {
      console.warn('Channel switch error', err);
    }
  };

  // 电台下一首 / 切台
  const handleNextRadioTrack = useCallback(async () => {
    if (radioQueue.length === 0) {
      await startRadioMode(radioChannel);
      return;
    }
    // 当电台随机池即将播完时，在后台静默补充更多随机曲目，保持无限播放
    if (currentIndex >= radioQueue.length - 2) {
      mediaApi.getRadioTracks(radioChannel, 30).then((fresh) => {
        setRadioQueue((prev) => [...prev, ...fresh]);
      }).catch(() => {});
    }
    let nextIdx = Math.floor(Math.random() * radioQueue.length);
    if (radioQueue.length > 1 && nextIdx === currentIndex) {
      nextIdx = (currentIndex + 1) % radioQueue.length;
    }
    setCurrentIndex(nextIdx);
    setCurrentTrack(radioQueue[nextIdx]);
  }, [radioQueue, currentIndex, radioChannel, startRadioMode]);

  // 退出电台模式
  const handleExitRadio = () => {
    setIsRadioMode(false);
    setPlayMode('loop-all');
  };

  // 全局键盘监听: R 电台 / S 收藏 / J/K 上一首下一首 / ? 快捷键面板
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (e.code === 'KeyR' && bare) {
        e.preventDefault();
        if (isRadioMode) {
          handleExitRadio();
        } else {
          startRadioMode('all');
        }
      }
      if (e.code === 'KeyS' && bare && currentTrack) {
        e.preventDefault();
        handleToggleFavorite(currentTrack);
      }
      if (e.code === 'KeyJ' && bare) {
        e.preventDefault();
        prevNextRef.current.prev();
      }
      if (e.code === 'KeyK' && bare) {
        e.preventDefault();
        prevNextRef.current.next();
      }
      if (e.key === '?' && bare) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isRadioMode, startRadioMode, currentTrack, handleToggleFavorite]);

  const handlePrevTrack = () => {
    if (playlist.length === 0) return;
    if (isRadioMode) {
      handleNextRadioTrack();
      return;
    }
    if (playMode === 'shuffle') {
      const idx = Math.floor(Math.random() * playlist.length);
      setCurrentIndex(idx);
      setCurrentTrack(playlist[idx]);
      return;
    }
    // 当前曲目不在列表里时，"上一首"取列表最后一条
    const idx = currentIndex < 0 ? playlist.length - 1 : (currentIndex - 1 + playlist.length) % playlist.length;
    setCurrentIndex(idx);
    setCurrentTrack(playlist[idx]);
  };

  const handleNextTrack = async () => {
    if (playlist.length === 0) return;
    if (isRadioMode) {
      handleNextRadioTrack();
      return;
    }
    if (playMode === 'loop-one') {
      // 单曲循环由 VideoJsPlayer 的 ended 处理（回到 0 重播），这里不做任何跳转
      return;
    }
    if (playMode === 'shuffle') {
      const idx = Math.floor(Math.random() * playlist.length);
      setCurrentIndex(idx);
      setCurrentTrack(playlist[idx]);
      return;
    }

    // 顺序/循环列表：播到当前列表末尾且还有下一页时，先加载下一页，
    // 让"下一首"继续往下播而不是回到列表开头。
    if (currentIndex >= playlist.length - 1 && hasMore && libraryActiveTab === 'tracks') {
      const more = await handleLoadMore();
      if (more && more.length > 0) {
        setCurrentTrack(more[0]);
        setCurrentIndex(tracks.length); // 新条目接在旧列表末尾之后
        return;
      }
    }

    const idx = currentIndex < 0 ? 0 : (currentIndex + 1) % playlist.length;
    setCurrentIndex(idx);
    setCurrentTrack(playlist[idx]);
  };

  // 键盘 J/K 走 ref，避免全局 keydown 闭包捕获旧的 playlist/currentIndex
  prevNextRef.current = { prev: handlePrevTrack, next: handleNextTrack };

  const handleQuickScan = async () => {
    setIsScanning(true);
    try {
      await mediaApi.scanLibrary();
      await loadData();
    } catch (err) {
      console.warn('Scan trigger error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-rose-500/30 selection:text-rose-200">
      {/* ================= ZONE 1, 2, 3: TOP BAR CONTRACT ================= */}
      <header className="sticky top-0 z-40 w-full bg-neutral-950/90 backdrop-blur-md border-b border-neutral-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-6">
          {/* Zone 1: Single Wordmark Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-950/40">
              <Tv className="w-4 h-4" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
              FastMusic
            </span>
          </div>

          {/* Zone 2: Primary Action Points — 筛选/收藏/历史都在列表工具栏, 页头不重复 */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => (isRadioMode ? handleExitRadio() : startRadioMode('all'))}
              title={isRadioMode ? '点击退出电台模式' : '进入随心电台，随机连播'}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 ${
                isRadioMode
                  ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white border-rose-400 shadow-rose-950/40'
                  : 'bg-neutral-900 hover:bg-neutral-800 text-rose-300 hover:text-rose-200 border-neutral-700/80'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isRadioMode ? 'animate-pulse text-white' : 'text-rose-400'}`} />
              <span>{isRadioMode ? '电台广播中' : '随心电台'}</span>
            </button>

            <button
              onClick={() => {
                setSelectedArtist(null);
                setSelectedAlbum(null);
                setLibraryActiveTab('favorites');
              }}
              title="查看我的收藏列表"
              className="relative p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            >
              <Heart className={`w-4 h-4 ${favorites.length > 0 ? 'text-rose-500 fill-rose-500' : 'text-neutral-400'}`} />
              {favorites.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 min-w-4 text-[10px] font-mono font-bold bg-rose-600 text-white rounded-full text-center">
                  {favorites.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsHistoryModalOpen(true)}
              title="播放历史记录"
              className="relative p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            >
              <History className="w-4 h-4 text-rose-400" />
              {history.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 min-w-4 text-[10px] font-mono font-bold bg-neutral-800 text-rose-300 border border-neutral-700 rounded-full text-center">
                  {history.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowShortcutsModal(true)}
              title="快捷键说明 (?)"
              className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            >
              <Keyboard className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsServerModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-200 hover:text-white transition-colors flex items-center gap-2 shadow-sm"
            >
              <Server className="w-3.5 h-3.5 text-rose-500" />
              <span className="hidden sm:inline">媒体服务配置 (Express)</span>
              <span className="sm:hidden">服务</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main App Canvas */}
      <main className="flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">

        {/* ================= HERO MEDIA PLAYER SECTION ================= */}
        <section className="w-full flex flex-col gap-3">
          {/* Radio Station Banner (rendered when in radio mode) */}
          <RadioStationBanner
            isRadioMode={isRadioMode}
            activeChannel={radioChannel}
            currentTrack={currentTrack}
            frequency={radioFrequency}
            onSwitchChannel={handleSwitchRadioChannel}
            onNextRandom={handleNextRadioTrack}
            onExitRadio={handleExitRadio}
          />

          <div className="w-full">
            <VideoJsPlayer
              currentTrack={currentTrack}
              streamUrl={currentStreamUrl}
              onPrev={handlePrevTrack}
              onNext={handleNextTrack}
              playMode={playMode}
              onChangePlayMode={setPlayMode}
              isTheaterMode={isTheaterMode}
              onToggleTheater={() => setIsTheaterMode(!isTheaterMode)}
              isFavorited={currentTrack ? favoriteIds.has(currentTrack.id) : false}
              onToggleFavorite={currentTrack ? () => handleToggleFavorite(currentTrack) : undefined}
            />
          </div>

          {/* 正在播放信息条: 一行搞定（封面 + 标题/歌手 + 技术规格 + 收藏），不再占用整张卡片 */}
          {currentTrack && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-neutral-900/50 rounded-xl border border-neutral-800/60">
              <div className="w-8 h-8 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-rose-400 overflow-hidden shrink-0">
                {currentTrack.cover_url ? (
                  <img
                    src={currentTrack.cover_url}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Tv className="w-4 h-4" />
                )}
              </div>

              <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-neutral-100 truncate">{currentTrack.title}</span>
                <span className="text-xs text-rose-400 font-medium truncate">{currentTrack.artist || '未知歌手'}</span>
                {currentTrack.album && (
                  <span className="text-[11px] text-neutral-500 truncate hidden sm:inline">{currentTrack.album}</span>
                )}
              </div>

              {/* 技术规格 + 转码状态（接口 URL 只在 title 里, 不占版面） */}
              <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400 shrink-0" title={currentTrack.stream_url}>
                <span className="uppercase text-neutral-200">{currentTrack.ext}</span>
                <span aria-hidden="true" className="text-neutral-600">·</span>
                <span className="tabular-nums">{(currentTrack.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                {currentTrack.transcode && (
                  <>
                    <span aria-hidden="true" className="text-neutral-600">·</span>
                    <span className={currentTrack.transcode.status === 'ready' ? 'text-emerald-400' : 'text-amber-400'}>
                      {currentTrack.transcode.status === 'ready'
                        ? `${currentTrack.transcode.container}`
                        : `转码 ${currentTrack.transcode.status}`}
                    </span>
                  </>
                )}
              </div>

              <button
                onClick={() => handleToggleFavorite(currentTrack)}
                title={favoriteIds.has(currentTrack.id) ? '点击取消收藏 (快捷键 S)' : '保存到收藏列表 (快捷键 S)'}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                  favoriteIds.has(currentTrack.id)
                    ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700/80'
                }`}
              >
                <Heart
                  className={`w-3.5 h-3.5 transition-all duration-200 ${
                    favoriteIds.has(currentTrack.id)
                      ? 'fill-rose-500 text-rose-500 scale-110'
                      : 'text-neutral-400 hover:text-rose-400'
                  }`}
                />
                <span>{favoriteIds.has(currentTrack.id) ? '已收藏' : '收藏'}</span>
              </button>
            </div>
          )}
        </section>

        {/* ================= MEDIA LIBRARY BROWSER ================= */}
        <section className="w-full flex-1 min-h-0 flex flex-col">
          <LibraryView
            tracks={tracks}
            totalTracks={totalTracks}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            artists={artists}
            albums={albums}
            currentTrackId={currentTrack?.id || null}
            onSelectTrack={handleSelectTrack}
            onScanClick={() => setIsServerModalOpen(true)}
            isScanning={isScanning}
            selectedArtist={selectedArtist}
            selectedAlbum={selectedAlbum}
            onFilterArtist={setSelectedArtist}
            onFilterAlbum={setSelectedAlbum}
            mediaTypeFilter={mediaTypeFilter}
            onFilterMediaType={setMediaTypeFilter}
            readyOnly={readyOnly}
            onToggleReadyOnly={handleToggleReadyOnly}
            hasLyricsOnly={hasLyricsOnly}
            onToggleHasLyrics={handleToggleHasLyrics}
            onLyricStatus={handleLyricStatus}
            sort={sort}
            onSortChange={handleSortChange}
            rowDensity={rowDensity}
            onToggleDensity={handleToggleDensity}
            searchQuery={searchInput}
            onSearchChange={setSearchInput}
            favoriteIds={favoriteIds}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            activeTab={libraryActiveTab}
            onTabChange={setLibraryActiveTab}
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-2 border-t border-neutral-900 bg-neutral-950 py-3 px-4 text-center text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <p>© 2026 FastMusic · 本地媒体流与无损音乐中心</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              className="hover:text-rose-400 transition-colors"
            >
              播放历史
            </button>
            <span aria-hidden="true" className="text-neutral-800">·</span>
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="hover:text-rose-400 transition-colors"
            >
              快捷键说明
            </button>
            <span aria-hidden="true" className="text-neutral-800">·</span>
            <button
              onClick={() => setIsServerModalOpen(true)}
              className="hover:text-neutral-300 transition-colors"
            >
              媒体服务配置
            </button>
            <span aria-hidden="true" className="text-neutral-800">·</span>
            <button
              onClick={handleQuickScan}
              disabled={isScanning}
              className="hover:text-rose-400 transition-colors"
            >
              重新扫描
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <PlayHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        history={history}
        onPlayTrack={handlePlayFromHistory}
        onRemoveItem={handleRemoveHistoryItem}
        onClearHistory={handleClearHistory}
      />

      <ServerConfigModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        onRefreshData={loadData}
      />

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6">
            <h3 className="font-semibold text-neutral-100 text-sm mb-4 flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-rose-500" />
              <span>键盘快捷键指南</span>
            </h3>
            <div className="space-y-3 text-xs text-neutral-300">
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">播放 / 暂停</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">Space</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">快退 5 秒</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">← 方向左键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">快进 5 秒</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">→ 方向右键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">调节音量</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">↑ / ↓ 方向键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">切换全屏</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">F 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">静音 / 恢复</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">M 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">上一首 / 下一首</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">J / K</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">随心电台 (随机连播)</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-rose-300">R 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">收藏 / 取消收藏当前曲目</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-rose-300">S 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">歌词 开 / 关</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-rose-300">L 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-neutral-400">本面板 开 / 关</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-white">?</kbd>
              </div>
            </div>
            <button
              onClick={() => setShowShortcutsModal(false)}
              className="mt-6 w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-medium transition-colors"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
