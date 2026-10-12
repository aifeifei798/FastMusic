import { MediaItem, ArtistSummary, AlbumSummary, ScanResponse, PaginatedTracksResponse, RadioChannel, TranscodeStatus, TranscodeInfo, TranscodeSummary, LyricsResult } from '../types/media';
export class MediaApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = localStorage.getItem('fastapi_base_url') || '';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    localStorage.setItem('fastapi_base_url', this.baseUrl);
  }

  getFullUrl(pathName: string): string {
    if (!this.baseUrl) return pathName;
    return `${this.baseUrl}${pathName.startsWith('/') ? '' : '/'}${pathName}`;
  }

  getStreamUrl(track: MediaItem): string {
    if (track.stream_url.startsWith('http://') || track.stream_url.startsWith('https://')) {
      return track.stream_url;
    }
    // 版本参数：mkv 转码产物随源 mtime 变化，避免浏览器缓存旧响应
    const stamp = track.mtime ? `?v=${Math.floor(track.mtime)}` : '';
    return `${this.baseUrl}${track.stream_url}${stamp}`;
  }

  async testConnection(): Promise<{ ok: boolean; message: string; trackCount?: number }> {
    try {
      const url = this.getFullUrl('/api/artists');
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const tracksRes = await fetch(this.getFullUrl('/api/tracks'), { method: 'GET', signal: AbortSignal.timeout(3000) });
        const tracks = tracksRes.ok ? await tracksRes.json() : [];
        const count = Array.isArray(tracks) ? tracks.length : tracks.total ?? 0;
        return { ok: true, message: 'Express / 媒体后端服务连接成功！', trackCount: count };
      }
      return { ok: false, message: `服务响应错误: 状态码 ${res.status}` };
    } catch (err: any) {
      return {
        ok: false,
        message: err.name === 'TimeoutError'
          ? '连接超时，请确认服务已启动'
          : `无法连接到 ${this.baseUrl || '当前 Express 服务'}。`
      };
    }
  }

  async getDirectories(): Promise<{ path: string; exists: boolean }[]> {
    try {
      const res = await fetch(this.getFullUrl('/api/directories'), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('Failed to fetch directories');
      const data = await res.json();
      return data.directories || [];
    } catch {
      return [];
    }
  }

  async updateDirectories(directories: string[]): Promise<void> {
    try {
      await fetch(this.getFullUrl('/api/directories'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directories }),
      });
    } catch (err) {
      console.warn('Update directories failed', err);
    }
  }

  async scanLibrary(paths?: string[] | string): Promise<ScanResponse> {
    const endpoint = this.getFullUrl('/api/scan');
    let body: any = {};
    if (Array.isArray(paths)) {
      body = { paths };
    } else if (typeof paths === 'string' && paths.trim()) {
      body = { path: paths.trim() };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.detail || `扫描失败: ${res.statusText}`);
    }
    return res.json();
  }

  async getArtists(): Promise<ArtistSummary[]> {
    try {
      const res = await fetch(this.getFullUrl('/api/artists'), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('Failed to fetch artists');
      return await res.json();
    } catch (err) {
      console.warn('API error or offline, no artists available', err);
      return [];
    }
  }

  async getAlbums(artist?: string): Promise<AlbumSummary[]> {
    try {
      const endpoint = this.getFullUrl('/api/albums');
      const url = new URL(endpoint, window.location.origin);
      if (artist) url.searchParams.append('artist', artist);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('Failed to fetch albums');
      return await res.json();
    } catch (err) {
      console.warn('API error or offline, no albums available', err);
      return [];
    }
  }

  async getTracks(filters?: {
    artist?: string;
    album?: string;
    media_type?: 'audio' | 'video';
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedTracksResponse> {
    const limit = filters?.limit ?? 30;
    const offset = filters?.offset ?? 0;

    try {
      const endpoint = this.getFullUrl('/api/tracks');
      const url = new URL(endpoint, window.location.origin);
      if (filters?.artist) url.searchParams.append('artist', filters.artist);
      if (filters?.album) url.searchParams.append('album', filters.album);
      if (filters?.media_type) url.searchParams.append('media_type', filters.media_type);
      if (filters?.search) url.searchParams.append('search', filters.search);
      url.searchParams.append('limit', String(limit));
      url.searchParams.append('offset', String(offset));

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('Failed to fetch tracks');
      const data = await res.json();
      if (Array.isArray(data)) {
        return {
          items: data.slice(offset, offset + limit),
          total: data.length,
          limit,
          offset,
          has_more: offset + limit < data.length,
        };
      }
      return {
        items: data.items ?? [],
        total: data.total ?? (data.items ? data.items.length : 0),
        limit: data.limit ?? limit,
        offset: data.offset ?? offset,
        has_more: data.has_more ?? (offset + (data.items?.length || 0) < (data.total || 0)),
      };
    } catch (err) {
      console.warn('API error or offline, no tracks available', err);
      return { items: [], total: 0, limit, offset, has_more: false };
    }
  }

  async getTrackDetail(trackId: string): Promise<MediaItem | null> {
    try {
      const res = await fetch(this.getFullUrl(`/api/tracks/${trackId}`), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  // 转码状态查询：.mkv 需要换容器（AV1/VP9 → WebM，H.264 → MP4，无损 remux），
  // Chrome 没有 Matroska demuxer。前端据此显示"排队 / 转码中 x% / 已就绪"。
  async getTranscodeStatus(trackId: string): Promise<TranscodeStatus | null> {
    try {
      const res = await fetch(this.getFullUrl(`/api/transcode/${trackId}`), {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      return (await res.json()) as TranscodeStatus;
    } catch (err) {
      return null;
    }
  }

  // 全库 .mkv 转码进度汇总（列表顶部统计条）
  async getTranscodeSummary(): Promise<TranscodeSummary | null> {
    try {
      const res = await fetch(this.getFullUrl('/api/transcode/summary'), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return (await res.json()) as TranscodeSummary;
    } catch (err) {
      return null;
    }
  }

  // 批量查询转码状态（列表轮询，只读，不触发转码）
  async getTranscodeStatusBatch(ids: string[]): Promise<Record<string, TranscodeInfo>> {
    if (ids.length === 0) return {};
    try {
      const url = new URL(this.getFullUrl('/api/transcode/status'), window.location.origin);
      url.searchParams.append('ids', ids.join(','));
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return {};
      const data = (await res.json()) as { items: Array<{ id: string; transcode: TranscodeInfo | null }> };
      const map: Record<string, TranscodeInfo> = {};
      for (const it of data.items || []) {
        if (it.transcode) map[it.id] = it.transcode;
      }
      return map;
    } catch (err) {
      return {};
    }
  }

  // 歌词：服务端代理网易云明文接口（搜索 title+artist → 匹配最佳歌曲 → 取 LRC）。
  // 网易云接口可能慢（首次 ~1-2s），超时返回 null 而不是抛错。
  async getLyrics(title: string, artist: string, duration?: number): Promise<LyricsResult | null> {
    try {
      const url = new URL(this.getFullUrl('/api/lyrics'), window.location.origin);
      url.searchParams.append('title', title || '');
      if (artist) url.searchParams.append('artist', artist);
      if (duration) url.searchParams.append('duration', String(Math.round(duration)));
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const data = await res.json();
      return data && typeof data === 'object' ? (data as LyricsResult) : null;
    } catch (err) {
      console.warn('Lyrics fetch failed', err);
      return null;
    }
  }

  async getRadioTracks(channel: RadioChannel = 'all', count: number = 50): Promise<MediaItem[]> {
    try {
      const endpoint = this.getFullUrl('/api/radio');
      const url = new URL(endpoint, window.location.origin);
      if (channel !== 'all') url.searchParams.append('media_type', channel);
      url.searchParams.append('count', String(count));

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          return data.items;
        }
      }
    } catch (err) {
      console.warn('API /api/radio failed', err);
    }
    return [];
  }
}

export const mediaApi = new MediaApiService();
