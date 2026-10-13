import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Server, 
  RefreshCw, 
  Radio, 
  History,
  Keyboard,
  Sparkles,
  Heart,
  Sun,
  Moon,
  Globe,
  MoreHorizontal
} from 'lucide-react';
import { MediaItem, ArtistSummary, AlbumSummary, PlayMode, PlayHistoryItem, RadioChannel, TrackSort } from './types/media';
import { mediaApi } from './services/api';
import { VideoJsPlayer } from './components/VideoJsPlayer';
import { LibraryView } from './components/LibraryView';
import { SystemConfigModal } from './components/SystemConfigModal';
import { PlayHistoryModal } from './components/PlayHistoryModal';
import { RadioStationBanner } from './components/RadioStationBanner';
import { LogoMark } from './components/Logo';
import { getLang, setLang, t, type Lang } from './utils/i18n';
import { useIsCompact } from './utils/responsive';

export default function App() {
  // Media library state
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const [totalTracks, setTotalTracks] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

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
  // 列表行密度: comfortable / compact（持久化）。窄屏默认紧凑，让一屏能看到更多曲目
  const [rowDensity, setRowDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      const saved = localStorage.getItem('fastmusic_density');
      if (saved === 'compact' || saved === 'comfortable') return saved;
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'compact' : 'comfortable';
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
  // 主题: dark(默认) / light。持久化到 localStorage('fastmusic_theme')，
  // 未设置时跟随系统 prefers-color-scheme。颜色全部走 index.css 的语义 token，
  // 切主题只需改 <html> 的 data-theme。
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('fastmusic_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  });
  // 界面语言: zh(默认) / en。持久化到 localStorage('fastmusic_lang')，文案走
  // utils/i18n 的 t() 查表（未收录的文案保持中文）。state 只用于触发重渲染，
  // 真正的语言在 i18n 模块里。
  const [lang, setLangState] = useState<Lang>(getLang());

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

  // 窄屏（<768px）布局：播放器默认折叠成胶囊、页头多余入口收进「更多」菜单、页脚隐藏
  const isCompact = useIsCompact();
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Element)) {
        setMoreMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreMenuOpen]);

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

  // 主题切换: 写 data-theme 到 <html>, Tailwind token 变量随之覆盖, 全站自动换肤
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('fastmusic_theme', theme); } catch {}
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // 语言切换: 先写 i18n 模块（t() 立即生效），再更新 state 触发全站重渲染
  const handleToggleLang = useCallback(() => {
    const next: Lang = getLang() === 'zh' ? 'en' : 'zh';
    setLang(next);
    setLangState(next);
  }, []);

  // 搜索防抖: 输入框文本 300ms 后才触发请求，避免每键一次全库扫描
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
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

  // 全局键盘监听: R 电台 / S 收藏 / J K 上一首下一首 / Space 播放暂停 / ← → 快退快进 /
  // ↑ ↓ 音量 / M 静音 / F 全屏 / V 频谱模式 / ? 快捷键面板
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      const controls = (window as unknown as {
        _fastMusicPlayerControls?: {
          togglePlay: () => void;
          seekBy: (delta: number) => void;
          adjustVolume: (delta: number) => void;
          toggleMute: () => void;
          toggleFullscreen: () => void;
          cycleVisualizer: () => void;
        };
      })._fastMusicPlayerControls;
      // video.js 自带 Space / ← → 快捷键（播放器有焦点时），跳过避免双重触发
      const target = e.target as HTMLElement | null;
      const inPlayer = !!target && typeof target.closest === 'function' && !!target.closest('.video-js');

      if (e.code === 'Space' && bare && !inPlayer) {
        e.preventDefault();
        controls?.togglePlay();
      }
      if (e.code === 'ArrowLeft' && bare && !inPlayer) {
        e.preventDefault();
        controls?.seekBy(-10);
      }
      if (e.code === 'ArrowRight' && bare && !inPlayer) {
        e.preventDefault();
        controls?.seekBy(10);
      }
      if (e.code === 'ArrowUp' && bare && !inPlayer) {
        e.preventDefault();
        controls?.adjustVolume(0.05);
      }
      if (e.code === 'ArrowDown' && bare && !inPlayer) {
        e.preventDefault();
        controls?.adjustVolume(-0.05);
      }
      if (e.code === 'KeyM' && bare) {
        e.preventDefault();
        controls?.toggleMute();
      }
      if (e.code === 'KeyF' && bare) {
        e.preventDefault();
        controls?.toggleFullscreen();
      }
      if (e.code === 'KeyV' && bare) {
        e.preventDefault();
        controls?.cycleVisualizer();
      }
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

  return (
    <div className="h-screen overflow-hidden bg-app text-ink flex flex-col font-sans selection:bg-accent/30 selection:text-accent-soft">
      {/* 品牌色光晕: 页头后面的一层 rose→amber 径向渐变, 让深浅页面都呼应徽标的渐变 */}
      <div className="fixed inset-0 -z-10 theme-wash pointer-events-none" aria-hidden="true" />

      {/* ================= ZONE 1, 2, 3: TOP BAR CONTRACT ================= */}
      <header className="sticky top-0 z-40 w-full bg-app/90 backdrop-blur-md border-b border-line/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-6">
          {/* Zone 1: 品牌徽标 + wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <LogoMark className="w-8 h-8 rounded-lg shadow-md shadow-accent/40" />
            <span className="hidden sm:inline text-lg font-bold tracking-tight text-ink whitespace-nowrap">
              FastMusic
            </span>
          </div>

          {/* Zone 2: Primary Action Points — 筛选/收藏/历史都在列表工具栏, 页头不重复。
              窄屏只保留 电台 / 收藏 / 主题 / 系统配置，其余收进「更多」菜单 */}
          <div className="relative flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              onClick={() => (isRadioMode ? handleExitRadio() : startRadioMode('all'))}
              title={isRadioMode ? t('电台广播中 · 点击退出电台模式') : t('随心电台 · 随机连播')}
              aria-label={t('随心电台')}
              className={`p-2 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 ${
                isRadioMode
                  ? 'bg-gradient-to-r from-accent to-amber text-white border-accent shadow-accent/40'
                  : 'bg-surface hover:bg-surface-2 text-accent-soft hover:text-accent-soft border-line-strong/80'
              }`}
            >
              <Radio className={`w-4 h-4 ${isRadioMode ? 'animate-pulse' : ''}`} />
            </button>

            <button
              onClick={() => {
                setSelectedArtist(null);
                setSelectedAlbum(null);
                setLibraryActiveTab('favorites');
              }}
              title={t('查看我的收藏列表')}
              className="relative p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Heart className={`w-4 h-4 ${favorites.length > 0 ? 'text-accent fill-accent' : 'text-muted'}`} />
              {favorites.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 min-w-4 text-[10px] font-mono font-bold bg-accent text-white rounded-full text-center">
                  {favorites.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsHistoryModalOpen(true)}
              title={t('播放历史记录')}
              className="relative hidden sm:block p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <History className="w-4 h-4 text-accent" />
              {history.length > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 min-w-4 text-[10px] font-mono font-bold bg-surface-2 text-accent-soft border border-line-strong rounded-full text-center">
                  {history.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowShortcutsModal(true)}
              title={t('快捷键说明 (?)')}
              className="hidden sm:block p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Keyboard className="w-4 h-4" />
            </button>

            <button
              onClick={handleToggleTheme}
              title={theme === 'dark' ? t('切换到浅色主题') : t('切换到深色主题')}
              aria-label={t('切换主题')}
              className="p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={handleToggleLang}
              title={lang === 'zh' ? t('切换到英文界面') : t('切换到中文界面')}
              aria-label={t('切换语言')}
              className="hidden sm:block p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Globe className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsServerModalOpen(true)}
              title={t('系统配置：扫描目录 / 全库缓存任务')}
              aria-label={t('系统配置')}
              className="p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Server className="w-4 h-4 text-accent" />
            </button>

            {/* 窄屏「更多」菜单: 历史 / 快捷键 / 语言 */}
            <div ref={moreMenuRef} className="relative sm:hidden">
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                title={t('更多')}
                aria-label={t('更多')}
                className="p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {moreMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-[220px] p-2 rounded-xl bg-surface border border-line shadow-xl shadow-black/60 flex flex-col gap-1">
                  <button
                    onClick={() => { setMoreMenuOpen(false); setIsHistoryModalOpen(true); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                  >
                    <History className="w-4 h-4 text-accent" />
                    <span>{t('播放历史')}</span>
                    {history.length > 0 && <span className="font-mono text-[10px] text-muted-2">{history.length}</span>}
                  </button>
                  <button
                    onClick={() => { setMoreMenuOpen(false); setShowShortcutsModal(true); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                  >
                    <Keyboard className="w-4 h-4" />
                    <span>{t('快捷键说明')}</span>
                  </button>
                  <button
                    onClick={() => { setMoreMenuOpen(false); handleToggleLang(); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                  >
                    <Globe className="w-4 h-4" />
                    <span>{lang === 'zh' ? t('切换到英文界面') : t('切换到中文界面')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main App Canvas */}
      <main className="flex-1 min-h-0 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-col gap-3 sm:gap-4">

        {/* ================= HERO MEDIA PLAYER SECTION ================= */}
        <section className="w-full flex flex-col gap-3">
          {/* Radio Station Banner (rendered when in radio mode) */}
          <RadioStationBanner
            isRadioMode={isRadioMode}
            activeChannel={radioChannel}
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
              isCompact={isCompact}
            />
          </div>

          {/* 「正在播放」信息条已删除: 歌名/歌手/专辑在舞台左列, 收藏按钮在控制胶囊里,
              格式/转码状态在列表行里 —— 这一行是重复信息, 省下的空间全部给列表高度 */}
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
            isCompact={isCompact}
            onPrevTrack={handlePrevTrack}
            onNextTrack={handleNextTrack}
          />
        </section>
      </main>

      {/* Footer — 窄屏隐藏（历史/快捷键/系统配置都在页头，省 ~40px 给列表） */}
      <footer className="hidden sm:block mt-2 border-t border-line-soft bg-app py-3 px-4 text-center text-xs text-muted-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogoMark className="w-5 h-5 rounded-md" />
            <p>{t('© 2026 FastMusic · 本地媒体流与无损音乐中心')}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              title={t('播放历史记录')}
              aria-label={t('播放历史')}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-accent transition-colors"
            >
              <History className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowShortcutsModal(true)}
              title={t('快捷键说明 (?)')}
              aria-label={t('快捷键说明')}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-accent transition-colors"
            >
              <Keyboard className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsServerModalOpen(true)}
              title={t('系统配置：扫描目录 / 全库缓存任务')}
              aria-label={t('系统配置')}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-ink-3 transition-colors"
            >
              <Server className="w-4 h-4" />
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

      <SystemConfigModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        onRefreshData={loadData}
      />

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-2xl p-6">
            <h3 className="font-semibold text-ink text-sm mb-4 flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-accent" />
              <span>{t('键盘快捷键指南')}</span>
            </h3>
            <div className="space-y-3 text-xs text-ink-3">
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('播放 / 暂停')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">Space</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('快退 10 秒')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">{t('← 方向左键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('快进 10 秒')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">{t('→ 方向右键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('调节音量')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">{t('↑ / ↓ 方向键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('切换全屏')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">{t('F 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('静音 / 恢复')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">{t('M 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('上一首 / 下一首')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">J / K</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('随心电台 (随机连播)')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-accent-soft">{t('R 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('收藏 / 取消收藏当前曲目')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-accent-soft">{t('S 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('歌词 开 / 关')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-accent-soft">{t('L 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="text-muted">{t('切换频谱模式')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-accent-soft">{t('V 键')}</kbd>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted">{t('本面板 开 / 关')}</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-2 font-mono text-[11px] text-ink">?</kbd>
              </div>
            </div>
            <button
              onClick={() => setShowShortcutsModal(false)}
              className="mt-6 w-full py-2 bg-surface-2 hover:bg-elevated text-ink rounded-xl text-xs font-medium transition-colors"
            >
              {t('我知道了')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
