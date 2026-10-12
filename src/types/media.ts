export interface MediaItem {
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
  mtime?: number; // 源文件 mtimeMs，用于 stream URL 版本参数
  transcode?: TranscodeInfo; // .mkv 的转码状态（服务端在 /api/tracks 响应里附带）
  lyric?: 'yes' | 'no' | null; // 歌词缓存状态：yes=有歌词, no=网易云没有, null/undefined=未查过
}

// .mkv 换容器(remux)状态：服务端 sidecar 引擎的只读快照。
// ready = sidecar 已就绪(容器 webm/mp4)，running = 正在 remux/转码，
// queued = 排队中，pending = 未入队(PRETRANCODE_MKV=0)，error = 失败。
export interface TranscodeInfo {
  status: 'ready' | 'running' | 'queued' | 'pending' | 'error';
  progress: number;      // 0-100，仅 running 时有意义
  container?: string;    // ready 时产物容器: webm | mp4
  out_size?: number;     // sidecar 字节数
}

export interface TranscodeSummary {
  total_mkv: number;
  ready: number;
  running: number;
  queued: number;
  pending: number;
  error: number;
}

export interface AlbumSummary {
  album_name: string;
  artist_name: string;
  track_count: number;
  cover_url?: string;
  // 代表曲目 id（封面已缓存时就是它，否则是该专辑任意一条曲目），用于"补全封面"批量解析
  cover_track_id?: string;
}

export interface ArtistSummary {
  artist_name: string;
  album_count: number;
  track_count: number;
  avatar_url?: string;
  cover_track_id?: string;
}

export type PlayMode = 'sequence' | 'loop-all' | 'loop-one' | 'shuffle';

// /api/tracks 排序键。default = 索引顺序（扫描顺序）
export type TrackSort = 'default' | 'title' | 'artist' | 'album' | 'duration' | 'size' | 'mtime' | 'random';

// MKV 转码状态（服务端 /api/transcode/:id 返回）。
// .mkv 没有 Chrome demuxer，服务端用 sidecar 换容器：AV1/VP9 → .mkv.webm，
// H.264 → .mkv.mp4（都是 -c copy 无损 remux），探测失败才 VP9+Opus 重编码。
export interface TranscodeStatus {
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;         // 0-100；分母取源时长（探测不到时保持 0）
  hasProgressTotal: boolean; // false = 进度百分比不可用，前端只显示"转码中…"
  error: string | null;
  ext: string;              // 源扩展名，前端据此判断是否需要等待转码
}

export interface ScanDirectoryConfig {
  path: string;
  label?: string;
  enabled?: boolean;
}

export interface ScanResponse {
  message: string;
  total_tracks: number;
  scanned_paths?: string[];
  scan_summary?: {
    total_files: number;
    tagged_files: number;
    path_parsed_files: number;
  };
}

export interface PaginatedTracksResult {
  items: MediaItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PaginatedTracksResponse {
  items: MediaItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// 歌词（服务端 /api/lyrics 返回，来源为网易云明文接口）
export interface LyricsResult {
  found: boolean;
  ncm_id?: number;
  matched_title?: string;
  matched_artist?: string;
  lyric: string;      // 原歌词 LRC
  tlyric: string;     // 翻译歌词
  romalrc: string;    // 罗马音歌词
  cached?: boolean;
  detail?: string;
}

export interface PlayHistoryItem {
  track: MediaItem;
  playedAt: number;
}

// 全库缓存任务（系统配置里的 4 个按钮，服务端后台执行）
export type CacheJobKind = 'track_covers' | 'artist_covers' | 'album_covers' | 'track_lyrics';

export interface CacheJob {
  kind: CacheJobKind;
  label: string;
  total: number;      // 全库条目数（含已缓存的）
  done: number;       // 已处理（含跳过）
  hits: number;       // 命中（有封面 / 有歌词）
  misses: number;     // 查过但没有结果
  errors: number;     // 网络/解析错误
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  remaining: number;  // 队列剩余
  etaSeconds: number; // 按当前速率估算的剩余时间
}

export interface CacheStats {
  tracks: number;
  artists: number;
  albums: number;
  covers_cached: number;
  cover_misses: number;
  lyrics_cached: number;
  lyric_hits: number;
}

export interface CacheStatus {
  jobs: CacheJob[];
  stats: CacheStats | null;
}

export type RadioChannel = 'all' | 'audio' | 'video';

export interface RadioResponse {
  items: MediaItem[];
  total: number;
  channel: RadioChannel;
}
