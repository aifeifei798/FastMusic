import React, { useEffect, useRef, useState, useCallback } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  Repeat, 
  Shuffle, 
  Tv, 
  PictureInPicture,
  Music,
  Film,
  Heart,
  Sliders,
  BarChart2,
  Waves,
  Disc,
  Activity,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Captions,
  EyeOff
} from 'lucide-react';
import { MediaItem, PlayMode, TranscodeStatus } from '../types/media';
import { AudioVisualizer, VisualizerMode } from './AudioVisualizer';
import { mediaApi } from '../services/api';

// --- 10段均衡器 (Equalizer) 配置 ---
// 均衡器 采用 audealize 的图形均衡器 模型：N 个 "peaking" BiquadFilter 串联，
// 中心频率 logarithmically spaced，每个 filter.gain 直接为 dB。
const EQ_BAND_FREQS: number[] = [20, 50, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// 面板显示用短标签: 长标签 (如 '125Hz') 会把 flex 列撑到 ~40px, 10 列总宽超过 w-72 面板,
// 导致右侧 4 条溢出面板背景; 完整频率放在 title 提示里。
const EQ_BAND_LABELS: string[] = ['20', '50', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_BAND_FULL_LABELS: string[] = ['20Hz', '50Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
const EQ_MIN_DB = -20;
const EQ_MAX_DB = 20;
const EQ_PEAKING_Q = 4.31;
// 预设均衡器 曲线（dB，按 EQ_BAND_FREQS 顺序）
const EQ_PRESETS: { name: string; label: string; curve: number[] }[] = [
  { name: 'flat', label: '平', curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'rock', label: '摇滚', curve: [10, 7, 5, 3, -2, -3, -1, 1, 3, 4] },
  { name: 'pop', label: '流行', curve: [-1, 3, 6, 7, 6, 2, 0, -2, -3, -4] },
  { name: 'classical', label: '古典', curve: [7, 6, 5, 3, 2, 0, -2, -3, -4, -5] },
  { name: 'electronic', label: '电子', curve: [8, 4, -2, -4, -2, 2, 4, 6, 8, 6] },
  { name: 'jazz', label: '爵士', curve: [4, 3, 2, 0, -1, 0, 2, 3, 4, 3] },
];
const EQ_PRESET_BY_NAME: Record<string, number[]> = EQ_PRESETS.reduce(
  (acc, p) => { acc[p.name] = p.curve; return acc; },
  {} as Record<string, number[]>,
);

// --- 歌词 (LRC) 解析 ---
// 一行可能有多个时间戳 ([00:01.00][00:02.00] 同一句), 展开成多条。
interface LyricLine {
  time: number;
  text: string;
}

// 作词/作曲/编曲/原唱这类元数据行不是歌词, 过滤掉, 否则开头滚动全是 credits
const LRC_META_LINE_RE =
  /^(作词|作曲|编曲|歌词|原唱|演唱|翻唱|艺人|统筹|监制|制作人|制作|混音|录音|母带|和声|吉他|贝斯|鼓|钢琴|笛|弦|合成|编程|出品|发行|版权|授权|OP|SP|CV|PV|Rap|Lyrics|Written|Composed|Arranged|Translated|Mixed|Recorded)/i;

function isMetaLine(text: string): boolean {
  // 【作词 : xxx】/【本音乐作品已获得正版授权】这类装饰行不是歌词
  if (/^【[^】]*】$/.test(text) || /^\[[^\]]*\]$/.test(text)) return true;
  // 去掉行首的括号装饰 (【作词 : xxx】) 再判断
  return LRC_META_LINE_RE.test(text.replace(/^[\[【(（]/, ''));
}

function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const rawLine of (raw || '').split(/\r?\n/)) {
    const stamps = Array.from(rawLine.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.,.](\d{1,3}))?\]/g));
    const text = rawLine.replace(/\[[^\]]*\]/g, '').trim();
    if (!text || isMetaLine(text)) continue;
    for (const m of stamps) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
      out.push({ time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// 翻译行按时间戳索引, 主歌词行渲染时查表并入 (同一时刻主句在上, 译文小字在下)
function buildTranslationMap(translation: LyricLine[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of translation) {
    const key = Math.round(line.time * 10);
    const prev = map.get(key);
    map.set(key, prev ? `${prev} / ${line.text}` : line.text);
  }
  return map;
}

// 时间戳容差 ±0.1s: 网易云主句与译文的时间戳常有微小差异
function findTranslation(map: Map<number, string>, time: number): string {
  const key = Math.round(time * 10);
  return map.get(key) || map.get(key - 1) || map.get(key + 1) || '';
}

interface VideoJsPlayerProps {
  currentTrack: MediaItem | null;
  streamUrl: string;
  onPrev: () => void;
  onNext: () => void;
  playMode: PlayMode;
  onChangePlayMode: (mode: PlayMode) => void;
  isTheaterMode: boolean;
  onToggleTheater: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
}

export const VideoJsPlayer: React.FC<VideoJsPlayerProps> = ({
  currentTrack,
  streamUrl,
  onPrev,
  onNext,
  playMode,
  onChangePlayMode,
  isTheaterMode,
  onToggleTheater,
  isFavorited = false,
  onToggleFavorite,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  // The init useEffect (deps []) closes over the FIRST onNext; App recreates handleNextTrack
  // every render with fresh currentIndex/playMode, so the ended handler must call the LATEST one.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  // 播放模式同理：init useEffect 的 deps 是 []，ended 处理器需要读最新的 playMode
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  // server metadata 里的真实时长（秒）。分片 MP4 下 Chrome 的 duration 先等于"已缓冲片段末尾"，
  // 必须用这个种子防止 durationchange 把真实时长覆盖成局部值。
  const seedDurationRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.7); // 默认音量 70%
  const [isMuted, setIsMuted] = useState<boolean>(false);
  // 音量增强 ×2: video.js 音量上限是 1, 增强靠音频图里的 GainNode 实现
  const [volumeBoost, setVolumeBoost] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fastmusic_boost') === '1';
    } catch {
      return false;
    }
  });
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isDraggingProgress, setIsDraggingProgress] = useState<boolean>(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);

  // 是否当前媒体真正有视频轨（浏览器解码权威判断，而非文件扩展猜测）。
  // 关键：.webm 是视频容器但 youtube-music 音频也用 .webm，扩展无法区分，
  // 所以靠 <video>.videoWidth>0 决定，而不是 server media_type。
  const [hasVideoTrack, setHasVideoTrack] = useState<boolean>(false);

  // 歌词竖列要贴紧"画面右边缘": 容器右缘到 <video> 右缘的距离 + 画面在 <video>
  // 内居中时产生的左右黑边(letterbox)。全屏时通常为 0 → 歌词贴屏幕右缘;
  // 普通/剧场模式下画面比容器窄, 黑边很大, 歌词若贴容器边缘就悬在黑色上。
  const [lyricRightInset, setLyricRightInset] = useState<number>(0);

  // 画面右边缘相对舞台右缘的偏移 = 容器右缘到 <video> 右缘 + 画面居中黑边。
  // 舞台是 absolute inset-0 覆盖容器, 所以把 grid 的 padding-right 设成这个值,
  // 歌词竖列就贴紧实际画面右边缘（全屏时 ≈ 0）。
  const updateLyricRightInset = () => {
    const v = videoRef.current;
    const c = containerRef.current;
    if (!v || !c || !v.videoWidth || !v.videoHeight) {
      setLyricRightInset(0);
      return;
    }
    const cRect = c.getBoundingClientRect();
    const vRect = v.getBoundingClientRect();
    const letterbox = Math.max(
      0,
      (vRect.width - vRect.height * (v.videoWidth / v.videoHeight)) / 2
    );
    setLyricRightInset(Math.max(0, Math.round(cRect.right - vRect.right + letterbox)));
  };

  // MKV 转码进度：.mkv 源需先经 ffmpeg 转成 WebM(VP9+Opus) 侧车文件
  // （本机 Chrome 跳过 VA-API 硬解，MP4/H.264 会黑屏有声，故统一转 WebM）。
  // 这里轮询 /api/transcode/:id 只为显示"排队/转码中 x%"徽章。
  // 关键：done 之后必须停止轮询、且 transcodeTick 至多 +1 一次——
  // 否则 source effect（依赖 transcodeTick）每 2 秒 player.src() 重挂一次，
  // 表现就是"播放 1 秒就从头循环 + 黑屏"。
  // 播放器自己那条 /api/stream 请求在服务端会阻塞到转码完成再返回，
  // 通常它能自行开播；只有转完 4 秒后仍无视频轨才补一次重载兜底。
  const [transcode, setTranscode] = useState<TranscodeStatus | null>(null);
  const [transcodeTick, setTranscodeTick] = useState<number>(0);
  const needsTranscode = !!currentTrack && currentTrack.ext === '.mkv';

  // 封面：/api/cover/:id 服务端三级兜底（本地内嵌 → iTunes → 网易云），字节缓存到 covers/。
  // 请求本身触发解析，加载成功才显示图片，否则保留渐变占位（黑胶底图）。
  const [coverLoaded, setCoverLoaded] = useState<boolean>(false);
  const coverImgRef = useRef<HTMLImageElement | null>(null);
  const coverUrl = currentTrack ? mediaApi.getFullUrl(`/api/cover/${currentTrack.id}`) : '';

  useEffect(() => {
    setCoverLoaded(false);
    // 浏览器缓存命中时 load 事件可能不再触发，直接查 complete 兜底
    const el = coverImgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setCoverLoaded(true);
  }, [currentTrack?.id, coverUrl]);

  useEffect(() => {
    if (!needsTranscode || !currentTrack) { setTranscode(null); return; }
    let cancelled = false;
    let sawPending = false;   // 是否亲眼看到该片处于排队/转码中
    let recovered = false;    // 兜底重载是否已触发（至多一次）
    let timer = 0;

    const tryRecover = () => {
      if (recovered || cancelled) return;
      recovered = true;
      const v = videoRef.current;
      // 已有画面 → 播放器自己接上了，绝不能重挂（重挂会打断正在播的视频）
      if (!v || v.videoWidth === 0) setTranscodeTick((t) => t + 1);
    };

    const poll = async () => {
      const st = await mediaApi.getTranscodeStatus(currentTrack.id);
      if (cancelled || !st) return;
      setTranscode(st);
      if (st.status === 'queued' || st.status === 'running') {
        sawPending = true;
        return;               // 继续轮询刷新徽章
      }
      // done / error：立刻停止轮询，不再反复触发 source effect
      window.clearInterval(timer);
      if (st.status === 'done' && sawPending) {
        window.setTimeout(tryRecover, 4000);
      }
    };

    void poll();
    timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [needsTranscode, currentTrack]);
  // --- 均衡器 state ---
  // eqBands 持久在 localStorage('fastmusic_eq')，初始为预设 'flat'
  const [eqBands, setEqBands] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('fastmusic_eq');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === EQ_BAND_FREQS.length) {
          return parsed.map((n) => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Number(n))));
        }
      }
    } catch (e) {
      // 忽略解析失败，使用默认
    }
    return EQ_PRESET_BY_NAME.flat.slice();
  });
  const [eqEnabled, setEqEnabled] = useState<boolean>(true);
  const [eqPreset, setEqPreset] = useState<string>('flat');
  const [showEqPanel, setShowEqPanel] = useState<boolean>(false);
  // 频谱模式持久在 localStorage('fastmusic_visualizer')，'none' = 无频谱(纯黑舞台)
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(() => {
    try {
      const saved = localStorage.getItem('fastmusic_visualizer');
      if (saved && ['bars', 'wave', 'circle', 'mirrored', 'none'].includes(saved)) {
        return saved as VisualizerMode;
      }
    } catch {
      // 忽略解析失败，使用默认
    }
    return 'bars';
  });

  // 切换频谱模式并持久化（'none' 表示不显示频谱）
  const changeVisualizerMode = useCallback((mode: VisualizerMode) => {
    setVisualizerMode(mode);
    try {
      localStorage.setItem('fastmusic_visualizer', mode);
    } catch {
      // localStorage 不可用时忽略
    }
  }, []);

  // --- 歌词 (网易云) ---
  // 开关持久在 localStorage('fastmusic_lyrics')；默认开启。
  const [showLyrics, setShowLyrics] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fastmusic_lyrics') !== '0';
    } catch {
      return true;
    }
  });
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricTranslations, setLyricTranslations] = useState<Map<number, string>>(new Map());
  // idle=未请求, loading=取歌词中, found=有歌词, none=网易云没有该曲歌词
  const [lyricStatus, setLyricStatus] = useState<'idle' | 'loading' | 'found' | 'none'>('idle');
  const [lyricMatch, setLyricMatch] = useState<{ title: string; artist: string; id?: number } | null>(null);
  // 歌词竖列: 把当前行平移到窗口垂直中心 (translateY), 上下行淡出
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);
  const [lyricOffset, setLyricOffset] = useState(0);
  // 歌词字号(px) 与视频时歌词列宽度(px)，都持久化
  const [lyricFont, setLyricFont] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem('fastmusic_lyric_font') || '13', 10);
      return Number.isFinite(v) && v > 0 ? v : 13;
    } catch {
      return 13;
    }
  });
  const [lyricWidth, setLyricWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem('fastmusic_lyric_width') || '340', 10);
      return Number.isFinite(v) && v > 0 ? v : 340;
    } catch {
      return 340;
    }
  });
  // 剧场模式（非全屏）舞台比屏幕窄，固定 340/420px 的歌词列会挤掉画面；
  // 按舞台实际可用宽度封顶（最多占 26%），窄屏自动收窄，全屏时保持用户选择。
  const effectiveLyricWidth = (() => {
    const c = containerRef.current;
    const stage = c ? c.getBoundingClientRect().width - lyricRightInset : lyricWidth;
    return Math.max(200, Math.min(lyricWidth, Math.round(stage * 0.26)));
  })();
  const [showLyricSettings, setShowLyricSettings] = useState<boolean>(false);

  useEffect(() => {
    if (!currentTrack) {
      setLyricLines([]);
      setLyricStatus('idle');
      setLyricMatch(null);
      return;
    }
    if (!showLyrics) return;

    let cancelled = false;
    setLyricLines([]);
    setLyricTranslations(new Map());
    setLyricMatch(null);
    setLyricStatus('loading');

    mediaApi
      .getLyrics(currentTrack.title, currentTrack.artist, currentTrack.duration)
      .then((r) => {
        if (cancelled) return;
        if (r && r.found && r.lyric) {
          const main = parseLrc(r.lyric);
          if (main.length) {
            setLyricLines(main);
            setLyricTranslations(buildTranslationMap(parseLrc(r.tlyric || '')));
            setLyricMatch({
              title: r.matched_title || currentTrack.title,
              artist: r.matched_artist || currentTrack.artist,
              id: r.ncm_id,
            });
            setLyricStatus('found');
          } else {
            setLyricStatus('none');
          }
        } else {
          setLyricStatus('none');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack, showLyrics]);

  // 歌词滚动: 当前行始终居中。box 是 relative, 所以 el.offsetTop 就是行在窗口内的位置。
  useEffect(() => {
    const box = lyricBoxRef.current;
    if (!box || !lyricLines.length) return;
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].time <= currentTime + 0.05) idx = i;
      else break;
    }
    const target = idx < 0 ? 0 : idx;
    const el = box.querySelector(`[data-lyric-idx="${target}"]`) as HTMLElement | null;
    if (!el) return;
    // 可为负: 前奏/第一句时列表需要向下平移
    setLyricOffset(el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2);
  }, [currentTime, lyricLines, lyricStatus, showLyrics]);

  const toggleLyrics = () => {
    // 函数式更新: 键盘快捷键的 handler 闭包可能持有旧 toggleLyrics,
    // 用 prev 而非 showLyrics 避免读到过期值
    setShowLyrics((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fastmusic_lyrics', next ? '1' : '0');
      } catch {
        // localStorage 不可用时忽略
      }
      return next;
    });
  };

  // 均衡器 Web Audio 节点（由 player 拥有整个 audio graph）
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const boostGainRef = useRef<GainNode | null>(null);
  const eqInputRef = useRef<GainNode | null>(null);
  const eqOutputRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Initialize Video.js Player instance
  useEffect(() => {
    if (!videoRef.current) return;

    const player = videojs(videoRef.current, {
      autoplay: true,
      controls: false, // We render our custom high-fidelity responsive UI controls
      // 注意: 不能开 fluid/responsive — wrapper 会被强制 16:9 高度(宽×9/16),
      // 超过 viewport 后被 overflow-hidden 上下裁切, 视频"上下缺一块"。
      // wrapper 由 CSS 撑满 viewport, tech 用 object-fit: contain 完整显示。
      preload: 'auto',
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
    });

    playerRef.current = player;
    // 默认音量 70%
    player.volume(0.7);

    player.on('play', () => {
      setIsPlaying(true);
      // 播放真正开始时确保 AudioContext 处于 running（读 window，绕过闭包 deps）
      const ctx = (window as unknown as { _fastMusicAudioContext?: AudioContext })._fastMusicAudioContext;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    });
    player.on('pause', () => {
      setIsPlaying(false);
      // 暂停时重新显示控制栏, 方便用户操作
      setShowControls(true);
    });
    player.on('ended', () => {
      setIsPlaying(false);
      // 单曲循环：回到开头重播，不请求"下一首"
      if (playModeRef.current === 'loop-one') {
        try {
          player.currentTime(0);
          player.play();
          setIsPlaying(true);
        } catch (e) {
          // ignore
        }
        return;
      }
      onNextRef.current();
    });

    player.on('timeupdate', () => {
      if (!isDraggingProgress) {
        const t = player.currentTime();
        if (Number.isFinite(t)) setCurrentTime(t || 0);
      }
      // Calculate buffer
      try {
        const buffered = player.buffered();
        if (buffered && buffered.length > 0) {
          setBufferedEnd(buffered.end(buffered.length - 1));
        }
      } catch (e) {
        // buffer inquiry error
      }
    });

    player.on('durationchange', () => {
      // fragmented MP4 (frag_keyframe+empty_moov): Chrome duration 是 Infinity/NaN 直到
      // 全文件 buffered；在此之前它等于"已缓冲片段末尾"(局部值)。
      // 有 server metadata 种子时，只接受 >= 种子的值，否则进度条百分比会乱跳。
      const dur = player.duration() ?? 0;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const seed = seedDurationRef.current;
      if (seed > 0 && dur < seed - 1) return;
      setDuration(dur);
    });

    player.on('volumechange', () => {
      setVolume(player.volume() || 1);
      setIsMuted(player.muted() || false);
    });

    player.on('ratechange', () => {
      setPlaybackRate(player.playbackRate() || 1);
    });

    // 浏览器解码后 metadata：真正视频轨 => videoWidth>0（webm/mkv/mp4 均对）
    player.on('loadedmetadata', () => {
      const v = videoRef.current;
      setHasVideoTrack(!!v && v.videoWidth > 0 && v.videoHeight > 0);
      updateLyricRightInset();
    });

    // Cleanup on unmount
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  // Update source when track or streamUrl changes
  useEffect(() => {
    if (!playerRef.current || !streamUrl) return;

    const player = playerRef.current;
    // 切换曲目：先复位视频轨判断，loadedmetadata 之后重新评估
    setHasVideoTrack(false);
    setIsDraggingProgress(false);
    setCurrentTime(0);
    setBufferedEnd(0);
    // fragmented MP4: Chrome duration 是 Infinity 直到 fully buffered → 先 seed 从
    // server metadata (秒), durationchange 之后只覆盖 >= 种子的值
    seedDurationRef.current = currentTrack?.duration || 0;
    setDuration(seedDurationRef.current);
    const isVideo = currentTrack?.media_type === 'video';
    // .webm 是视频容器：始终给 video/webm 让 <video>/video.js 走视频 tech，
    // 音频-only webm 仍解码（videoWidth=0），真正 video webm 显示画面。
    // .mkv: server 用 sidecar 侧车文件（源旁 foo.mkv.webm / foo.mkv.mp4）无损 remux，
    // Chrome 没有 Matroska demuxer，所以必须换容器。type 只是 video.js 选 tech 的提示，
    // 真正的容器由 Chrome 嗅探，所以这里给 video/webm 也能播 MP4 sidecar。
    const ext = currentTrack?.ext;
    const mime = isVideo
      ? (ext === '.mkv' || ext === '.webm' ? 'video/webm' : 'video/mp4')
      : (ext === '.flac' ? 'audio/flac'
        : ext === '.webm' ? 'video/webm'
        : ext === '.m4a' ? 'audio/mp4'
        : ext === '.ogg' || ext === '.opus' ? 'audio/ogg'
        : ext === '.wav' ? 'audio/wav'
        : 'audio/mp3');

    player.src({
      src: streamUrl,
      type: mime,
    });

    player.ready(() => {
      player.play()?.catch((err: any) => {
        // Autoplay may be restricted by browser until user gesture
        console.warn('Autoplay prevented or pending interaction:', err);
      });
    });
  }, [streamUrl, currentTrack?.id, transcodeTick]);

  // --- 均衡器: 拥有整个 audio graph (source -> 10 peaking biquad -> analyser -> destination) ---
  // 将当前 eqBands 到每个 filter.gain（peaking filter.gain 直接为 dB）
  const applyEqCurve = () => {
    const filters = eqFiltersRef.current;
    for (let i = 0; i < filters.length; i++) {
      filters[i].gain.value = eqEnabled ? eqBands[i] : 0;
    }
  };

  const saveEq = () => {
    try {
      localStorage.setItem('fastmusic_eq', JSON.stringify(eqBands));
    } catch (e) {
      console.warn('Failed to save equalizer to localStorage', e);
    }
  };

  // 构建均衡器 graph once the media element exists. 复用 shared AudioContext +
  // MediaElementAudioSourceNode（WeakMap）与 AudioVisualizer 的约定。
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
      _fastMusicAudioContext?: AudioContext;
      _fastMusicSourceMap?: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
      _fastMusicAnalyser?: AnalyserNode | null;
    };
    const AudioContextClass = win.AudioContext || win.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!win._fastMusicAudioContext) {
      win._fastMusicAudioContext = new AudioContextClass();
    }
    const audioCtx = win._fastMusicAudioContext;
    if (!win._fastMusicSourceMap) {
      win._fastMusicSourceMap = new WeakMap();
    }

    try {
      let source = win._fastMusicSourceMap.get(el);
      if (!source) {
        source = audioCtx.createMediaElementSource(el);
        win._fastMusicSourceMap.set(el, source);
      }

      const input = audioCtx.createGain();
      const filters = EQ_BAND_FREQS.map(() => audioCtx.createBiquadFilter());
      const output = audioCtx.createGain();
      // 音量增强 ×2 的增益节点 (video.js 音量上限 1, 只能靠 GainNode 翻倍)
      const boostGain = audioCtx.createGain();
      boostGain.gain.value = volumeBoost ? 2 : 1;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins
      analyser.smoothingTimeConstant = 0.82;

      // 串联：source -> input -> filter[0] -> ... -> filter[9] -> output -> boostGain -> analyser -> destination
      source.disconnect();
      source.connect(input);
      input.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i++) {
        filters[i].connect(filters[i + 1]);
      }
      filters[filters.length - 1].connect(output);
      output.connect(boostGain);
      boostGain.connect(analyser);
      analyser.connect(audioCtx.destination);

      filters.forEach((f, i) => {
        f.type = 'peaking';
        f.frequency.value = EQ_BAND_FREQS[i];
        f.Q.value = EQ_PEAKING_Q;
      });

      eqFiltersRef.current = filters;
      eqInputRef.current = input;
      eqOutputRef.current = output;
      boostGainRef.current = boostGain;
      analyserRef.current = analyser;
      win._fastMusicAnalyser = analyser;
      (win as unknown as { _fastMusicBoostGain?: GainNode })._fastMusicBoostGain = boostGain;

      applyEqCurve();

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (err) {
      // Cross-origin media (seed remote URLs) cannot be hooked — audio plays via
      // video.js without EQ, and the visualizer falls back to synthetic animation.
      console.info('[VideoJsPlayer] Web Audio equalizer hook:', err);
    }
  }, [videoRef.current]);

  // 将 eqBands/eqEnabled 到均衡器 gains whenever they change
  useEffect(() => {
    applyEqCurve();
  }, [eqBands, eqEnabled]);

  // Track Fullscreen status
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      updateLyricRightInset();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 容器尺寸变化（全屏/剧场/窗口 resize）时重新计算歌词贴边偏移
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    updateLyricRightInset();
    const ro = new ResizeObserver(() => updateLyricRightInset());
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Controls auto-hide timer: 音频与视频统一 — 播放中 3.5s 无鼠标操作后隐藏控制栏
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying]);

  const handleMouseMove = () => {
    resetControlsTimer();
  };

  // 鼠标离开播放区域 → 立即隐藏控制栏 (音频/视频统一; 暂停时保留控制栏方便操作)
  const handleMouseLeave = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    if (isPlaying) {
      setShowControls(false);
    }
  };

  // 播放开始时也武装自动隐藏计时器: 即使鼠标不经过播放区, 控制栏也会 3.5s 后隐藏
  useEffect(() => {
    if (isPlaying) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const player = playerRef.current;
      if (!player) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (player.paused()) {
            resumeAudioContext();
            player.play();
          } else player.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          player.currentTime(Math.max(0, (player.currentTime() || 0) - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          player.currentTime(Math.min(player.duration() || 0, (player.currentTime() || 0) + 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.volume(Math.min(1, (player.volume() || 0) + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.volume(Math.max(0, (player.volume() || 0) - 0.1));
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyM':
          e.preventDefault();
          player.muted(!player.muted());
          break;
        case 'KeyL':
          e.preventDefault();
          toggleLyrics();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // 恢复 AudioContext。createMediaElementSource 已把媒体元素音频永久路由过 Web Audio 图，
  // 而 AudioContext 在无用户手势时创建会停在 suspended —— 此时元素"在播"但 currentTime 卡在 0，
  // 无声音/无画面。resume() 必须在用户手势（点击/按键）内调用才会被 Chrome 放行。
  const resumeAudioContext = () => {
    const ctx = (window as unknown as { _fastMusicAudioContext?: AudioContext })._fastMusicAudioContext;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  // Control action handlers
  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused()) {
      // 清除 scrub 锁: 否则 timeupdate 的 !isDraggingProgress 守卫冻结 UI 时间/进度条
      // (mousedown 在 scrub bar 但 mouseup 在 play button → isDraggingProgress 残留 true)
      setIsDraggingProgress(false);
      resumeAudioContext();
      player.play();
    } else {
      player.pause();
    }
  };

  const handleSeek = (newTime: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime(newTime);
    setCurrentTime(newTime);
  };

  const handleProgressScrubStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingProgress(true);
    handleProgressScrub(e);
  };

  const handleProgressScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (duration <= 0) return;
    const targetTime = pos * duration;
    setCurrentTime(targetTime);
    // 始终 seek：拖拽中也要真正移动播放头（timeupdate 守卫只冻结 UI 时间显示，不冻结 seek）
    handleSeek(targetTime);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);
  };

  const handleProgressScrubEnd = () => {
    setIsDraggingProgress(false);
  };

  const handleProgressMouseLeave = () => {
    setHoverTime(null);
    setIsDraggingProgress(false);
  };

  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    player.muted(!isMuted);
  };

  // 音量增强 ×2: 切换音频图里的 boostGain 增益 (状态持久化到 localStorage)
  const toggleVolumeBoost = () => {
    const next = !volumeBoost;
    setVolumeBoost(next);
    try {
      localStorage.setItem('fastmusic_boost', next ? '1' : '0');
    } catch {
      // ignore
    }
    if (boostGainRef.current) {
      boostGainRef.current.gain.value = next ? 2 : 1;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const player = playerRef.current;
    if (!player) return;
    player.volume(val);
    if (val > 0 && isMuted) {
      player.muted(false);
    }
  };

  const setSpeed = (rate: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.playbackRate(rate);
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  // --- 均衡器 control handlers ---
  const applyEqPreset = (name: string) => {
    const curve = EQ_PRESET_BY_NAME[name];
    if (!curve) return;
    setEqBands(curve.slice());
    setEqPreset(name);
    setEqEnabled(true);
    saveEq();
  };

  const resetEq = () => {
    setEqBands(EQ_PRESET_BY_NAME.flat.slice());
    setEqPreset('flat');
    saveEq();
  };

  const toggleEqEnabled = () => {
    setEqEnabled(!eqEnabled);
    saveEq();
  };

  // 均衡器 垂直 slider 拖操作：从 pointer Y 计算 dB 值（top = max, bottom = min）
  const eqDraggingRef = useRef<boolean>(false);
  const handleEqScrub = (index: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const val = Math.round(EQ_MIN_DB + pct * (EQ_MAX_DB - EQ_MIN_DB));
    const next = eqBands.slice();
    next[index] = val;
    setEqBands(next);
    setEqPreset('manual');
    saveEq();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('Picture in Picture failed:', err);
    }
  };

  const cyclePlayMode = () => {
    const modes: PlayMode[] = ['sequence', 'loop-all', 'loop-one', 'shuffle'];
    const nextIdx = (modes.indexOf(playMode) + 1) % modes.length;
    onChangePlayMode(modes[nextIdx]);
  };

  // 画面/可视化切换: server 已正确分类 .mkv/.mp4 等为 video (media_type),
  // 但 .webm 音频-only 与 video 同 ext 需 browser videoWidth 判断 → 两者 OR 组合。
  const isVideo = currentTrack?.media_type === 'video' || hasVideoTrack;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0;

  // 当前歌词行 = 时间戳 <= currentTime 的最后一条（时间轴已排序，遇到更大的即停）
  let activeLyricIndex = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    if (lyricLines[i].time <= currentTime + 0.05) activeLyricIndex = i;
    else break;
  }
  // 前奏阶段(还没到第一句)也把第一句居中, 只是不"高亮"
  const lyricIdx = activeLyricIndex < 0 ? 0 : activeLyricIndex;


  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      // video.js 主题覆盖用 arbitrary variant 写(后代选择器), 不再手写 CSS 规则。
      // 注意: video.js 会在运行时注入 <style class="vjs-styles-defaults">(.video-js{width:300px;height:150px}),
      // 它不在任何 @layer 里, 优先级高于 Tailwind 的 utilities layer, 所以这些覆盖必须加 ! 后缀。
      className={`relative w-full bg-neutral-950 flex flex-col justify-between overflow-hidden transition-all duration-300 [&_.vjs-custom-theme]:font-[inherit]! [&_.vjs-custom-theme]:bg-transparent! [&_.vjs-custom-theme]:w-full! [&_.vjs-custom-theme]:h-full! [&_.vjs-custom-theme_.vjs-tech]:object-contain! [&_.video-js:focus]:outline-none! ${
        isFullscreen ? 'h-screen w-screen' : isTheaterMode ? 'h-[clamp(300px,calc(100vh-300px),580px)] rounded-2xl border border-neutral-800 shadow-2xl' : 'h-[clamp(240px,calc(100vh-420px),440px)] rounded-2xl border border-neutral-800/80 shadow-xl'
      }`}
    >
      {/* Top Overlay Badge & Header Info */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-neutral-950/80 via-neutral-950/40 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-neutral-900/80 border border-neutral-700/60 backdrop-blur-md text-xs font-semibold">
            {isVideo ? (
              <Film className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Music className="w-3.5 h-3.5 text-rose-400" />
            )}
            {/* .mkv 实际流是转码后的 WebM 侧车，徽章显示真实播放格式 */}
            <span className="uppercase text-neutral-200">
              {currentTrack?.ext === '.mkv' ? 'webm' : currentTrack?.ext?.replace('.', '') || 'MEDIA'}
            </span>
            <span className="text-neutral-500">|</span>
            <span className="text-rose-400 font-mono">
              {isVideo ? 'HD MTV' : 'LOSSLESS'}
            </span>
          </div>

          <div className="hidden sm:block text-xs text-neutral-300 font-medium truncate max-w-xs md:max-w-md">
            {currentTrack ? `${currentTrack.artist} — ${currentTrack.title}` : '未选择曲目'}
          </div>
        </div>

        {/* MKV 转码状态：本机 Chrome 跳过 VA-API 硬解，MKV 需先转 WebM 才能出画面 */}
        {needsTranscode && transcode && transcode.status !== 'done' && (
          <div
            title={transcode.error || undefined}
            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium border backdrop-blur-md ${
              transcode.status === 'error'
                ? 'bg-red-950/70 border-red-800/70 text-red-300'
                : 'bg-amber-950/70 border-amber-800/70 text-amber-300'
            }`}
          >
            {transcode.status === 'error' ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            <span>
              {transcode.status === 'error'
                ? '转码失败'
                : transcode.status === 'queued'
                ? '排队中…'
                : transcode.progress > 0
                ? `转码中 ${transcode.progress}%`
                : '转码中…'}
            </span>
          </div>
        )}

        {/* Quick action buttons in top bar — same row as the media badge */}
        <div className="flex items-center gap-2">
          {isVideo && (
            <button
              onClick={togglePiP}
              title="画中画 (Picture in Picture)"
              className="p-1.5 rounded-lg bg-neutral-900/70 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors border border-neutral-800"
            >
              <PictureInPicture className="w-4 h-4" />
            </button>
          )}

          {/* 均衡器 视觉模式切换 — 音频曲目，与媒体标记同一行 */}
          {!isVideo && (
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-950/80 border border-neutral-800/80 backdrop-blur-md shadow-lg">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeVisualizerMode('bars');
                }}
                title="经典柱状频谱 (Bars EQ)"
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  visualizerMode === 'bars'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">柱状频谱</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeVisualizerMode('wave');
                }}
                title="示波器波形 (Waveform)"
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  visualizerMode === 'wave'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <Waves className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">波形图</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeVisualizerMode('circle');
                }}
                title="光晕环状频谱 (Circular Halo)"
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  visualizerMode === 'circle'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <Disc className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">光晕环</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeVisualizerMode('mirrored');
                }}
                title="对称双向频谱 (Mirrored EQ)"
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  visualizerMode === 'mirrored'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">对称频谱</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeVisualizerMode('none');
                }}
                title="无频谱（纯黑舞台，只保留歌词与信息）"
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  visualizerMode === 'none'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">无</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Media Viewport */}
      <div 
        // 全屏沉浸: 控制栏隐藏时指针也消失。video.js 的 wrapper/<video> 继承这里的 cursor,
        // 所以直接切换这个容器的 utility 即可(不需要 .cursor-none 后代覆盖规则)。
        className={`relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden ${
          isFullscreen && isVideo && !showControls ? 'cursor-none' : 'cursor-pointer'
        }`}
        onClick={togglePlay}
      >
        {/* The Video.js underlying element.
            注意: video.js 初始化时会把这些类复制到它自动创建的 wrapper div, 且 wrapper 的类
            之后不会随 React 更新。若这里用条件类 (如 !isVideo 时 opacity-0), 音频曲目初始化
            后 wrapper 会永久 opacity-0 → 选视频曲目时画面全黑。所以保持静态类, 音频曲目时
            由 z-10 的 visualizer 覆盖层盖住黑底即可。 */}
        <video
          ref={videoRef}
          className="video-js vjs-custom-theme w-full h-full"
          playsInline
        />

        {/* MKV 转码中：黑屏中央大字进度，避免"看起来是 mkv 播不了"的误解 */}
        {needsTranscode && transcode && transcode.status !== 'done' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70">
            {transcode.status === 'error' ? (
              <AlertTriangle className="w-10 h-10 text-red-400" />
            ) : (
              <Loader2 className="w-10 h-10 animate-spin text-rose-400" />
            )}
            <p className="text-neutral-200 font-medium text-lg">
              {transcode.status === 'error'
                ? '转码失败'
                : transcode.status === 'queued'
                ? '后台转码排队中…'
                : transcode.progress > 0
                ? `转码中 ${transcode.progress}%`
                : '转码中…'}
            </p>
            <p className="text-xs text-neutral-500 max-w-md text-center">
              MKV 需转成 WebM(VP9+Opus) 才能在本机 Chrome 出画面，完成后自动开始播放。
            </p>
          </div>
        )}

        {/* Audio Visualizer (rendered when media is audio; '无' 模式不渲染, 舞台保持纯黑) */}
        {!isVideo && currentTrack && visualizerMode !== 'none' && (
          <div className="absolute inset-0 z-10 w-full h-full">
            <AudioVisualizer
              isPlaying={isPlaying}
              mediaElement={videoRef.current}
              visualizerMode={visualizerMode}
            />
          </div>
        )}

        {/* Big Center Play/Pause indicator on hover or pause */}
        {isVideo && !isPlaying && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <div className="w-16 h-16 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-2xl hover:scale-110 transition-transform">
              <Play className="w-8 h-8 ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* 舞台布局 — 音频: 三列网格(左 = 歌名/歌手, 中 = 唱片留空区, 右 = 歌词竖列)。
          视频(MTV): 画面本身就是主角, 左侧信息列与唱片留空区都不渲染, 只保留右侧歌词竖列。
          中间列固定宽度且居中，所以唱片不会被文字压住；pointer-events-none 不干扰点击播放/控制栏 */}
      {currentTrack && (
        <div
          className={`absolute inset-0 z-[15] pointer-events-none grid gap-4 px-5 sm:px-7 ${
            isVideo ? '' : 'grid-cols-[1fr_240px_1fr]'
          }`}
          style={{
            gridTemplateRows: '1fr',
            // 视频时右列贴紧画面右边缘: 覆盖 px-5 sm:px-7 的右内边距。
            // 列宽必须用 inline style —— Tailwind 的 arbitrary class 是静态扫描生成的,
            // 带运行时插值的 `grid-cols-[1fr_${n}px]` 不会生成任何 CSS 规则。
            ...(isVideo
              ? {
                gridTemplateColumns: `1fr ${effectiveLyricWidth}px`,
                paddingRight: `${lyricRightInset}px`,
              }
              : {}),
          }}
          title={
            lyricMatch
              ? `歌词来源: 网易云 · ${lyricMatch.title} - ${lyricMatch.artist}`
              : ''
          }
        >
          {/* 左列: 正在播放的曲目信息 (仅音频曲目; min-h-0 让 grid 的 1fr 行不被内容撑高) */}
          {!isVideo && (
            <div className="min-w-0 min-h-0 flex flex-col justify-center gap-1.5 text-right pr-3">
              <span className="text-[10px] uppercase tracking-[0.22em] text-neutral-500">正在播放</span>
              <h2 className="text-lg sm:text-xl font-bold leading-tight text-neutral-100 break-words drop-shadow-md">
                {currentTrack.title}
              </h2>
              <p className="text-sm font-medium text-rose-400">{currentTrack.artist || '未知歌手'}</p>
              {currentTrack.album && (
                <p className="text-[11px] leading-snug text-neutral-500 break-words">{currentTrack.album}</p>
              )}
            </div>
          )}

          {/* 中间列: 唱片 — 有封面时封面铺满整张唱片(黑胶纹路叠在上面 + 中心 spindle 孔),
              没封面时退回黑胶纹路 + 中心标签占位。封面来自 /api/cover/:id 三级兜底
              (本地内嵌 → iTunes → 网易云)。频谱选"无"时 AudioVisualizer 不挂载, 唱片仍然在这里转。
              两侧 hairline 让三列结构更清晰 */}
          {!isVideo && (
            <div className="self-center relative h-[62%] flex items-center justify-center">
              <span className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-neutral-700/45 to-transparent" />
              <span className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-neutral-700/45 to-transparent" />
              <div
                className={`relative h-[min(100%,220px)] aspect-square rounded-full bg-neutral-950 border-4 border-neutral-800/90 shadow-2xl flex items-center justify-center ${
                  isPlaying ? 'animate-[spin_14s_linear_infinite] shadow-rose-950/50' : ''
                }`}
              >
                {/* 黑胶底: 同心纹路（无封面时就是整张唱片的样子） */}
                <span
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    backgroundImage:
                      'repeating-radial-gradient(circle at center, rgba(255,255,255,0.10) 0 1px, transparent 1px 5px)',
                  }}
                />
                {/* 没有封面时的中心标签占位（与列表行的 coverGradient 风格一致） */}
                <div className="relative w-[66%] h-[66%] rounded-full overflow-hidden shadow-inner border-2 border-neutral-700 bg-neutral-900 flex items-center justify-center">
                  <div className="absolute inset-0 bg-gradient-to-tr from-rose-950 via-neutral-900 to-neutral-950 flex items-center justify-center text-rose-400 font-bold text-xl">
                    🎵
                  </div>
                </div>
                {/* 封面铺满整张唱片: 淡入覆盖黑胶底与标签 */}
                {coverUrl && (
                  <img
                    ref={coverImgRef}
                    src={coverUrl}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-500 ${
                      coverLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                    onLoad={() => setCoverLoaded(true)}
                    onError={() => setCoverLoaded(false)}
                  />
                )}
                {/* 封面上叠加的黑胶纹路 + 外缘暗环, 让铺满的封面仍然像唱片 */}
                <span
                  className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-500"
                  style={{
                    backgroundImage:
                      'repeating-radial-gradient(circle at center, rgba(0,0,0,0.55) 0 1px, transparent 1px 5px)',
                    opacity: coverLoaded ? 0.32 : 0,
                  }}
                />
                <span
                  className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-500"
                  style={{ boxShadow: 'inset 0 0 26px rgba(0,0,0,0.6)', opacity: coverLoaded ? 1 : 0 }}
                />
                {/* Spindle center hole */}
                <span className="absolute w-6 h-6 rounded-full bg-neutral-950 border-2 border-neutral-700/70" />
              </div>
            </div>
          )}

          {/* 右列: 歌词竖列 (当前行居中高亮, 上下行淡出)。
              视频时左两列不渲染, 必须显式 col-start-2 让歌词贴右边缘, 否则它会落到第一列(左侧) */}
          {showLyrics && (
            <div className={`relative min-w-0 min-h-0 h-full flex flex-col justify-center gap-2 pl-3 ${isVideo ? 'col-start-2' : ''}`}>
              {/* 视频时歌词压在画面上, 用一层从左到右渐隐的暗底保证可读性 */}
              {isVideo && (
                <span className="absolute inset-0 -z-10 bg-gradient-to-l from-black/60 via-black/25 to-transparent rounded-lg" />
              )}
              {lyricStatus === 'loading' && (
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>正在从网易云获取歌词…</span>
                </div>
              )}

              {lyricStatus === 'none' && (
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Captions className="w-3.5 h-3.5" />
                  <span>网易云未找到「{currentTrack.title}」的歌词</span>
                </div>
              )}

              {lyricStatus === 'found' && (
                <div
                  ref={lyricBoxRef}
                  className="relative flex-1 min-h-0 overflow-hidden [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,#000_26%,#000_74%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_26%,#000_74%,transparent_100%)]"
                >
                  <div
                    className="flex flex-col gap-2 transition-transform duration-500 ease-out"
                    style={{ transform: `translateY(${-lyricOffset}px)` }}
                  >
                    {lyricLines.map((line, i) => {
                      const d = i - lyricIdx;
                      const trans = d === 0 ? findTranslation(lyricTranslations, line.time) : '';
                      return (
                        <p
                          key={i}
                          data-lyric-idx={i}
                          // 字号来自歌词设置(动态值用 inline style, 其余全部是 utility 类)
                          style={{ fontSize: d === 0 ? lyricFont + 3 : lyricFont }}
                          className={`font-[Noto_Serif_CJK_SC,Noto_Serif,Georgia,serif] leading-[1.5] tracking-[0.01em] text-white/34 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)] transition-[color,opacity] duration-300 ${
                            d === 0
                              ? 'text-white font-semibold pl-2.5 border-l-2 border-rose-500/55 [text-shadow:0_1px_8px_rgba(0,0,0,0.6),0_0_22px_rgba(244,63,94,0.2)]'
                              : d < 0
                              ? 'opacity-50'
                              : 'opacity-[0.85]'
                          }`}
                        >
                          {line.text}
                          {trans && (
                            <span className="mt-0.5 block text-[11px] leading-snug italic text-neutral-500">
                              {trans}
                            </span>
                          )}
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 歌词样式面板 — 字号 + (视频时) 歌词列宽度, 持久在 localStorage */}
      {showLyricSettings && (
        <div className="absolute right-4 bottom-16 z-40 w-64 rounded-xl bg-neutral-950/85 border border-neutral-800 p-3 flex flex-col gap-2 shadow-2xl">
          <div className="text-[11px] font-semibold text-neutral-300">歌词样式</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-500">字号</span>
            {[12, 14, 17].map((v) => (
              <button
                key={v}
                onClick={(e) => {
                  e.stopPropagation();
                  setLyricFont(v);
                  try { localStorage.setItem('fastmusic_lyric_font', String(v)); } catch {}
                }}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  lyricFont === v ? 'bg-rose-600/20 text-rose-300 border border-rose-500/40' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {v === 12 ? '小' : v === 14 ? '中' : '大'}
              </button>
            ))}
          </div>
          {isVideo && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-neutral-500">宽度</span>
              {[240, 340, 420].map((v) => (
                <button
                  key={v}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLyricWidth(v);
                    try { localStorage.setItem('fastmusic_lyric_width', String(v)); } catch {}
                  }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    lyricWidth === v ? 'bg-rose-600/20 text-rose-300 border border-rose-500/40' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  {v === 240 ? '窄' : v === 340 ? '标准' : '宽'}
                </button>
              ))}
            </div>
          )}
          {isVideo && effectiveLyricWidth < lyricWidth && (
            <p className="text-[10px] text-neutral-500">舞台宽度有限，歌词列自动收窄到 {effectiveLyricWidth}px</p>
          )}
          {!showLyrics && (
            <p className="text-[10px] text-neutral-500">歌词当前关闭 — 打开后设置生效</p>
          )}
        </div>
      )}

      {/* 均衡器 (Equalizer) 面板 — 10段 Web Audio 均衡器，预设 + 手动调节 */}
      {showEqPanel && (
        <div className="absolute left-4 bottom-16 z-40 w-72 rounded-xl bg-neutral-950/85 border border-neutral-800 p-3 flex flex-col gap-2 shadow-2xl">
          {/* 面板 header: 标题 + 状态 + 手动/平 reset + 均衡器 on/off */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-200 flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5" />
              均衡器 · {eqEnabled ? 'ON' : 'OFF'} · {eqPreset === 'manual' ? '手动' : EQ_PRESETS.find((p) => p.name === eqPreset)?.label || '平'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); toggleEqEnabled(); }}
                title="均衡器 开/关"
                className="p-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-2xs"
              >
                {eqEnabled ? '关' : '开'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); resetEq(); }}
                title="重置均衡器 (平)"
                className="p-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-2xs"
              >
                平
              </button>
            </div>
          </div>

          {/* 预设均衡器 按钮 */}
          <div className="flex items-center gap-1 flex-wrap">
            {EQ_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={(e) => { e.stopPropagation(); applyEqPreset(p.name); }}
                title={`预设: ${p.label}`}
                className={`p-1 rounded-md text-2xs transition-colors ${
                  eqPreset === p.name
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-400/60'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 10 段均衡器 垂直 slider */}
          <div className="flex items-stretch gap-1.5 w-full">
            {EQ_BAND_FREQS.map((freq, i) => {
              const pct = (eqBands[i] - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB);
              return (
                <div key={freq} className="flex flex-col items-center gap-1 flex-1">
                  <div
                    onMouseDown={(e) => { eqDraggingRef.current = true; handleEqScrub(i)(e); }}
                    onMouseMove={(e) => { if (eqDraggingRef.current) handleEqScrub(i)(e); }}
                    onMouseUp={(e) => { eqDraggingRef.current = false; }}
                    className="relative w-1.5 h-32 rounded-full bg-neutral-700 cursor-pointer"
                  >
                    {/* 0dB 基准线 */}
                    <div className="absolute w-2.5 h-0.5 bg-neutral-500 pointer-events-none top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2" />
                    {/* slider handle 位置 = 当前 dB */}
                    <div
                      className="absolute w-4 h-2 rounded bg-rose-500 shadow pointer-events-none left-1/2 -translate-x-1/2"
                      style={{ bottom: `${pct * 100}%` }}
                    />
                  </div>
                  <span className="text-2xs text-neutral-400" title={`频段: ${EQ_BAND_FULL_LABELS[i]}`}>{EQ_BAND_LABELS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sleek Bottom Control Bar — absolute 悬浮在视频之上: 不占布局高度,
          隐藏 (opacity-0) 时视频画面直接透出, 不会留下黑带 */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 w-full bg-gradient-to-t from-neutral-950 via-neutral-950/95 to-transparent pt-6 pb-3 px-4 sm:px-6 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Interactive Scrubbing Progress Bar */}
        <div
          className="relative group w-full h-5 flex items-center cursor-pointer select-none"
          onMouseDown={handleProgressScrubStart}
          onMouseMove={handleProgressMouseMove}
          onMouseUp={handleProgressScrubEnd}
          onMouseLeave={handleProgressMouseLeave}
        >
          {/* Track background */}
          <div className="relative w-full h-1.5 group-hover:h-2.5 rounded-full bg-neutral-800 transition-all overflow-hidden">
            {/* Buffered bar */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-neutral-700/60 transition-all duration-200"
              style={{ width: `${Math.min(100, bufferPercent)}%` }}
            />
            {/* Played bar */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-rose-600 to-rose-400"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>

          {/* Draggable Scrubber Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 group-hover:w-4 group-hover:h-4 bg-white rounded-full shadow-lg border-2 border-rose-500 -ml-2 pointer-events-none transition-transform"
            style={{ left: `${progressPercent}%` }}
          />

          {/* Hover Time Tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-[11px] font-mono text-neutral-200 pointer-events-none shadow-md"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Secondary Row: Playback Controls, Time, Volume, Speed, Fullscreen */}
        <div className="flex items-center justify-between gap-3 mt-2">
          {/* Left Controls: Prev, Play/Pause, Next & Time */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onPrev}
              title="上一首 (Previous)"
              className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={togglePlay}
              title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            <button
              onClick={onNext}
              title="下一首 (Next)"
              className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {/* Time Indicator */}
            <div className="text-xs font-mono text-neutral-400 tabular-nums ml-1">
              <span className="text-neutral-200 font-medium">{formatTime(currentTime)}</span>
              <span className="mx-1 text-neutral-600">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls: Volume, PlayMode, Speed, Fullscreen */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Volume Control */}
            <div className="flex items-center gap-2 group/vol">
              <button
                onClick={toggleMute}
                title={isMuted ? '取消静音 (M)' : '静音 (M)'}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 sm:w-20 h-1 accent-rose-500 bg-neutral-800 rounded-lg cursor-pointer"
                title={`音量: ${Math.round(volume * 100)}%${volumeBoost ? ' ×2 增强' : ''}`}
              />

              {/* 音量增强 ×2 开关 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVolumeBoost();
                }}
                title={volumeBoost ? '音量增强 ×2 (已开启, 点击关闭)' : '音量增强 ×2 (音乐增强)'}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  volumeBoost
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                }`}
              >
                ×2
              </button>
            </div>

            {/* Favorite button */}
            {onToggleFavorite && currentTrack && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                title={isFavorited ? '已收藏 (点击取消收藏)' : '收藏当前曲目'}
                className={`p-2 rounded-lg hover:bg-neutral-800/80 transition-colors cursor-pointer ${
                  isFavorited ? 'text-rose-500' : 'text-neutral-400 hover:text-rose-400'
                }`}
              >
                <Heart className={`w-4 h-4 transition-transform active:scale-125 ${isFavorited ? 'fill-rose-500' : ''}`} />
              </button>
            )}

            {/* Play Mode Switcher */}
            <button
              onClick={cyclePlayMode}
              title={`模式: ${
                playMode === 'sequence'
                  ? '顺序播放'
                  : playMode === 'loop-all'
                  ? '列表循环'
                  : playMode === 'loop-one'
                  ? '单曲循环'
                  : '随机播放'
              }`}
              className={`p-2 rounded-lg hover:bg-neutral-800/80 transition-colors ${
                playMode === 'loop-one'
                  ? 'text-rose-400 font-bold'
                  : playMode === 'shuffle'
                  ? 'text-amber-400'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {playMode === 'shuffle' ? (
                <Shuffle className="w-4 h-4" />
              ) : (
                <div className="relative">
                  <Repeat className="w-4 h-4" />
                  {playMode === 'loop-one' && (
                    <span className="absolute -top-1.5 -right-2 text-[9px] font-bold text-rose-400">1</span>
                  )}
                </div>
              )}
            </button>

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2 py-1 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-300 hover:text-white transition-colors"
              >
                {playbackRate}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-9 right-0 py-1.5 w-24 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl flex flex-col z-50 text-xs">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setSpeed(rate)}
                      className={`px-3 py-1.5 text-left font-mono hover:bg-neutral-800 transition-colors ${
                        playbackRate === rate ? 'text-rose-400 font-bold bg-neutral-800/50' : 'text-neutral-300'
                      }`}
                    >
                      {rate.toFixed(2).replace(/\.00$/, '')}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏 (F)' : '全屏播放 (F)'}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            {/* 剧场宽屏模式 (moved from top bar) */}
            {!isFullscreen && (
              <button
                onClick={onToggleTheater}
                title={isTheaterMode ? '退出剧场模式' : '剧场宽屏模式'}
                className={`p-2 rounded-lg hover:bg-neutral-800/80 transition-colors ${
                  isTheaterMode ? 'text-rose-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Tv className="w-4 h-4" />
              </button>
            )}

            {/* 歌词开关 (网易云 LRC) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLyrics();
              }}
              title={showLyrics ? '隐藏歌词 (L)' : '显示歌词 (L)'}
              className={`p-2 rounded-lg hover:bg-neutral-800/80 transition-colors ${
                showLyrics ? 'text-rose-400' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Captions className="w-4 h-4" />
            </button>

            {/* 歌词样式设置 (字号 / 视频时歌词列宽度) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowLyricSettings((v) => !v);
              }}
              title="歌词字号与宽度"
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold hover:bg-neutral-800/80 transition-colors ${
                showLyricSettings ? 'text-rose-400' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Aa
            </button>

            {/* 均衡器 面板开关 (moved from top bar) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowEqPanel(!showEqPanel);
              }}
              title="均衡器 (Equalizer) 面板"
              className={`p-2 rounded-lg hover:bg-neutral-800/80 transition-colors ${
                showEqPanel ? 'text-rose-400' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
