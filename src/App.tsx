import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Tv, 
  Server, 
  ListMusic, 
  RefreshCw, 
  Radio, 
  History,
  Keyboard,
  Sparkles,
  Heart
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, PlayMode, PlayHistoryItem, RadioChannel } from './types/media';
import { mediaApi } from './services/api';
import { VideoJsPlayer } from './components/VideoJsPlayer';
import { LibraryView } from './components/LibraryView';
import { PlayQueueModal } from './components/PlayQueueModal';
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  // 只看"已转码/可直接播"的 .mkv（排队/转码中的隐藏）。持久化到 localStorage。
  const [readyOnly, setReadyOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('fastmusic_ready_only') === '1'; } catch { return false; }
  });

  // Player state
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [playMode, setPlayMode] = useState<PlayMode>('loop-all');
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  // Radio mode state (随心电台)
  const [isRadioMode, setIsRadioMode] = useState<boolean>(false);
  const [radioChannel, setRadioChannel] = useState<RadioChannel>('all');
  const [radioFrequency, setRadioFrequency] = useState<string>('FM 102.4 MHz');

  // Modals state
  const [isQueueModalOpen, setIsQueueModalOpen] = useState<boolean>(false);
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
          search: searchQuery.trim() || undefined,
          ready_only: readyOnly || undefined,
          limit: 30,
          offset: 0,
        }),
      ]);

      setArtists(artistData);
      setAlbums(albumData);
      setTracks(trackData.items);
      setTotalTracks(trackData.total);
      setHasMore(trackData.has_more);

      // If queue is empty, populate with first batch of tracks
      if (queue.length === 0 && trackData.items.length > 0) {
        setQueue(trackData.items);
        setCurrentIndex(0);
      }
    } catch (err) {
      console.error('Failed to load library data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtist, selectedAlbum, mediaTypeFilter, searchQuery, readyOnly, queue.length]);

  // Load More Tracks on scroll near bottom (limit=30, offset=currentLength)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const moreData = await mediaApi.getTracks({
        artist: selectedArtist || undefined,
        album: selectedAlbum || undefined,
        media_type: mediaTypeFilter === 'all' ? undefined : mediaTypeFilter,
        search: searchQuery.trim() || undefined,
        ready_only: readyOnly || undefined,
        limit: 30,
        offset: tracks.length,
      });

      setTracks((prev) => [...prev, ...moreData.items]);
      setHasMore(moreData.has_more);
      setTotalTracks(moreData.total);
    } catch (err) {
      console.error('Failed to load more tracks:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, selectedArtist, selectedAlbum, mediaTypeFilter, searchQuery, readyOnly, tracks.length]);

  // 「只看已转码」开关：持久化，切换后 loadData 依赖 readyOnly 会自动重新拉取
  const handleToggleReadyOnly = useCallback(() => {
    setReadyOnly((prev) => {
      const next = !prev;
      try { localStorage.setItem('fastmusic_ready_only', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Current track from queue
  const currentTrack: MediaItem | null = queue.length > 0 ? queue[currentIndex] || null : null;
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

  // Track selection and queue management
  const handleSelectTrack = (track: MediaItem) => {
    const existingIdx = queue.findIndex((t) => t.id === track.id);
    if (existingIdx !== -1) {
      setCurrentIndex(existingIdx);
    } else {
      const newQueue = [...queue, track];
      setQueue(newQueue);
      setCurrentIndex(newQueue.length - 1);
    }
  };

  const handleAddToQueue = (track: MediaItem) => {
    if (!queue.some((t) => t.id === track.id)) {
      setQueue([...queue, track]);
    }
  };

  // Start Radio Mode: 进入电台即刻随机洗牌并自动起播
  const startRadioMode = useCallback(async (channel: RadioChannel = 'all') => {
    setIsRadioMode(true);
    setRadioChannel(channel);
    setPlayMode('shuffle');

    // 随机调谐器频率
    const randFreq = `FM ${(88 + Math.random() * 20).toFixed(1)} MHz`;
    setRadioFrequency(randFreq);

    try {
      const radioTracks = await mediaApi.getRadioTracks(channel, 50);
      if (radioTracks && radioTracks.length > 0) {
        setQueue(radioTracks);
        const randIdx = Math.floor(Math.random() * radioTracks.length);
        setCurrentIndex(randIdx);
      } else if (tracks.length > 0) {
        let pool = tracks;
        if (channel === 'audio') pool = tracks.filter((t) => t.media_type === 'audio');
        if (channel === 'video') pool = tracks.filter((t) => t.media_type === 'video');
        const candidatePool = pool.length > 0 ? pool : tracks;
        setQueue(candidatePool);
        const randIdx = Math.floor(Math.random() * candidatePool.length);
        setCurrentIndex(randIdx);
      }
    } catch (err) {
      console.warn('Radio launch fallback', err);
      if (tracks.length > 0) {
        setQueue(tracks);
        setCurrentIndex(Math.floor(Math.random() * tracks.length));
      }
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
        setQueue(radioTracks);
        const randIdx = Math.floor(Math.random() * radioTracks.length);
        setCurrentIndex(randIdx);
      }
    } catch (err) {
      console.warn('Channel switch error', err);
    }
  };

  // 电台下一首 / 切台
  const handleNextRadioTrack = useCallback(async () => {
    if (queue.length === 0) {
      await startRadioMode(radioChannel);
      return;
    }
    // 当电台队列即将播完时，在后台静默补充更多随机曲目，保持无限播放
    if (currentIndex >= queue.length - 2) {
      mediaApi.getRadioTracks(radioChannel, 30).then((fresh) => {
        setQueue((prev) => [...prev, ...fresh]);
      }).catch(() => {});
    }
    let nextIdx = Math.floor(Math.random() * queue.length);
    if (queue.length > 1 && nextIdx === currentIndex) {
      nextIdx = (currentIndex + 1) % queue.length;
    }
    setCurrentIndex(nextIdx);
  }, [queue, currentIndex, radioChannel, startRadioMode]);

  // 退出电台模式
  const handleExitRadio = () => {
    setIsRadioMode(false);
    setPlayMode('loop-all');
  };

  // 全局键盘监听: R 键快速进入/退出随心电台模式
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (isRadioMode) {
          handleExitRadio();
        } else {
          startRadioMode('all');
        }
      }
      if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && !e.altKey && currentTrack) {
        e.preventDefault();
        handleToggleFavorite(currentTrack);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isRadioMode, startRadioMode, currentTrack, handleToggleFavorite]);

  const handlePrevTrack = () => {
    if (queue.length === 0) return;
    if (isRadioMode) {
      handleNextRadioTrack();
      return;
    }
    if (playMode === 'shuffle') {
      const randomIdx = Math.floor(Math.random() * queue.length);
      setCurrentIndex(randomIdx);
    } else {
      const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
      setCurrentIndex(prevIdx);
    }
  };

  const handleNextTrack = () => {
    if (queue.length === 0) return;
    if (isRadioMode) {
      handleNextRadioTrack();
      return;
    }
    if (playMode === 'loop-one') {
      // re-trigger same index
      setCurrentIndex(currentIndex);
    } else if (playMode === 'shuffle') {
      const randomIdx = Math.floor(Math.random() * queue.length);
      setCurrentIndex(randomIdx);
    } else {
      const nextIdx = (currentIndex + 1) % queue.length;
      setCurrentIndex(nextIdx);
    }
  };

  const handleRemoveFromQueue = (index: number) => {
    const newQueue = queue.filter((_, idx) => idx !== index);
    setQueue(newQueue);
    if (index === currentIndex) {
      if (newQueue.length > 0) {
        setCurrentIndex(Math.min(currentIndex, newQueue.length - 1));
      } else {
        setCurrentIndex(0);
      }
    } else if (index < currentIndex) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleClearQueue = () => {
    setQueue([]);
    setCurrentIndex(0);
  };

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single Wordmark Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-950/40">
              <Tv className="w-4 h-4" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
              FastMusic
            </span>
          </div>

          {/* Zone 2: Concise Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-neutral-400">
            <button
              onClick={() => {
                setSelectedArtist(null);
                setSelectedAlbum(null);
                setMediaTypeFilter('all');
              }}
              className="hover:text-white transition-colors whitespace-nowrap cursor-pointer"
            >
              全部媒体
            </button>
            <button
              onClick={() => setMediaTypeFilter('video')}
              className={`hover:text-white transition-colors whitespace-nowrap cursor-pointer ${
                mediaTypeFilter === 'video' ? 'text-rose-400 font-semibold' : ''
              }`}
            >
              MTV 视频
            </button>
            <button
              onClick={() => setMediaTypeFilter('audio')}
              className={`hover:text-white transition-colors whitespace-nowrap cursor-pointer ${
                mediaTypeFilter === 'audio' ? 'text-rose-400 font-semibold' : ''
              }`}
            >
              无损音乐
            </button>
            <button
              onClick={() => startRadioMode('all')}
              className={`transition-all flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg cursor-pointer ${
                isRadioMode
                  ? 'bg-rose-600/20 text-rose-300 font-semibold border border-rose-500/40 shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isRadioMode ? 'text-rose-400 animate-pulse' : 'text-rose-400'}`} />
              <span>随心电台</span>
              {isRadioMode && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping ml-0.5" />
              )}
            </button>
            <button
              onClick={() => {
                setSelectedArtist(null);
                setSelectedAlbum(null);
                setLibraryActiveTab('favorites');
              }}
              className={`hover:text-rose-400 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                libraryActiveTab === 'favorites' ? 'text-rose-400 font-semibold' : ''
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${favorites.length > 0 ? 'text-rose-500 fill-rose-500' : 'text-neutral-400'}`} />
              <span>我的收藏 ({favorites.length})</span>
            </button>
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              className="text-neutral-400 hover:text-white font-medium transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-rose-400" />
              <span>播放历史 ({history.length})</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action Points */}
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
              onClick={() => setIsQueueModalOpen(true)}
              title="播放队列"
              className="relative p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white transition-colors"
            >
              <ListMusic className="w-4 h-4" />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 min-w-4 text-[10px] font-mono font-bold bg-rose-600 text-white rounded-full text-center">
                  {queue.length}
                </span>
              )}
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-8">

        {/* ================= HERO MEDIA PLAYER SECTION ================= */}
        <section className="w-full flex flex-col gap-4">
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

          {/* Current Playing Track Context Card */}
          {currentTrack && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-neutral-900/60 rounded-2xl border border-neutral-800/80">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center text-rose-400 font-bold overflow-hidden shrink-0">
                  {currentTrack.cover_url ? (
                    <img
                      src={currentTrack.cover_url}
                      alt={currentTrack.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Tv className="w-5 h-5" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="font-semibold text-sm text-neutral-100 truncate">
                      {currentTrack.title}
                    </div>
                    {favoriteIds.has(currentTrack.id) && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                        <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                        <span>已收藏</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 flex items-center gap-2 mt-0.5">
                    <span className="text-rose-400 font-medium">{currentTrack.artist}</span>
                    <span aria-hidden="true" className="text-neutral-600">·</span>
                    <span className="truncate">{currentTrack.album}</span>
                  </div>
                </div>
              </div>

              {/* Right Side: Favorite Heart Button + Stream technical specs */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0">
                {/* '收藏' (Heart) 按钮 */}
                <button
                  onClick={() => handleToggleFavorite(currentTrack)}
                  title={favoriteIds.has(currentTrack.id) ? '点击取消收藏 (快捷键 L)' : '保存到收藏列表 (快捷键 L)'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer ${
                    favoriteIds.has(currentTrack.id)
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 shadow-rose-950/40'
                      : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700/80'
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 transition-all duration-200 ${
                      favoriteIds.has(currentTrack.id)
                        ? 'fill-rose-500 text-rose-500 scale-110'
                        : 'text-neutral-400 hover:text-rose-400'
                    }`}
                  />
                  <span>{favoriteIds.has(currentTrack.id) ? '已收藏' : '收藏'}</span>
                </button>

                {/* Technical stream details (unboxed typography) */}
                <div className="flex items-center gap-3 sm:gap-4 text-xs font-mono text-neutral-400">
                  <div className="flex items-center gap-1.5">
                    <span className="text-neutral-500">封装:</span>
                    <span className="uppercase text-neutral-200">{currentTrack.ext}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-neutral-500">大小:</span>
                    <span className="text-neutral-200 tabular-nums">
                      {(currentTrack.file_size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="hidden md:flex items-center gap-1.5">
                    <span className="text-neutral-500">接口:</span>
                    <span className="text-neutral-300 truncate max-w-xs">{currentTrack.stream_url}</span>
                  </div>
                </div>
              </div>
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
            onAddToQueue={handleAddToQueue}
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
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onStartRadio={() => startRadioMode('all')}
            favoriteIds={favoriteIds}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            activeTab={libraryActiveTab}
            onTabChange={setLibraryActiveTab}
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-neutral-900 bg-neutral-950 py-8 px-4 text-center text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 FastMusic. 高性能本地媒体流与无损音乐中心.</p>
          <div className="flex items-center gap-4">
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
      <PlayQueueModal
        isOpen={isQueueModalOpen}
        onClose={() => setIsQueueModalOpen(false)}
        queue={queue}
        currentIndex={currentIndex}
        onSelectIndex={setCurrentIndex}
        onRemoveTrack={handleRemoveFromQueue}
        onClearQueue={handleClearQueue}
      />

      <PlayHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        history={history}
        onPlayTrack={handlePlayFromHistory}
        onAddToQueue={handleAddToQueue}
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
                <span className="text-neutral-400">随心电台 (随机连播)</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-rose-300">R 键</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-neutral-800/60">
                <span className="text-neutral-400">收藏 / 取消收藏当前曲目</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-800 font-mono text-[11px] text-rose-300">L 键</kbd>
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
