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
}

export interface AlbumSummary {
  album_name: string;
  artist_name: string;
  track_count: number;
  cover_url?: string;
}

export interface ArtistSummary {
  artist_name: string;
  album_count: number;
  track_count: number;
  avatar_url?: string;
}

export type PlayMode = 'sequence' | 'loop-all' | 'loop-one' | 'shuffle';

// MKV 转码状态（服务端 /api/transcode/:id 返回）。
// .mkv 无法直接被 Chrome demux，且本机 Chrome 跳过 VA-API 硬解导致
// MP4/H.264 黑屏有声，故统一经 ffmpeg 转成 WebM(VP9+Opus) 再流式播放。
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

export type RadioChannel = 'all' | 'audio' | 'video';

export interface RadioResponse {
  items: MediaItem[];
  total: number;
  channel: RadioChannel;
}
