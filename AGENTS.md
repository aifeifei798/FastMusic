# AGENTS.md — FastMusic

FastMusic is a local music/MTV streaming player: a React SPA served by an Express
media backend that scans local directories and streams files over HTTP. The project
was generated from Google AI Studio (`metadata.json`, `README.md` banner).

## Running it

- **`./server.sh start`** is the real deploy path — it auto-`npm install`s, backgrounds
  `npm run dev`, writes `.server.pid` + `server.log`, and health-checks `/api/health`.
  Also supports `stop | restart | status | logs | install`. Default port `3000`
  (override with `PORT=...`).
- `npm run dev` / `npm run start` both run **`tsx server.ts`** — `server.ts` is executed
  directly by the `tsx` dev-dependency, it is NOT compiled to JS first.
- `npm run lint` is just **`tsc --noEmit`** (no ESLint, no formatter, no typecheck tool
  beyond this). There is **no test suite and no CI** — do not invent test commands.
- `npm run build` → `vite build` writes `dist/`; `npm run clean` removes `dist` + `server.js`.

## Architecture (the non-obvious wiring)

`server.ts` is the single entrypoint and does **both** jobs:
1. Express JSON API + local file streaming (the media backend).
2. In dev (`process.env.NODE_ENV !== 'production'`) it embeds a Vite server
   (`createViteServer({ server: { middlewareMode: true } })`) to serve the SPA; in
   production it serves the prebuilt `dist/` instead (`server.ts:686-703`).

Client SPA flow: `index.html` → `/src/main.tsx` → `src/App.tsx` (central UI + all
playback/library state). UI pieces live in `src/components/`.

- **Audio graph is owned by `VideoJsPlayer.tsx`**, not the visualizer: the player wires
  `source → 10 peaking BiquadFilters (均衡器) → boostGain (×2 音量增强, localStorage
  'fastmusic_boost') → analyser → destination` and publishes the
  analyser on `window._fastMusicAnalyser`. Default player volume is 70%. `AudioVisualizer.tsx` is a **pure consumer** — it
  reads `window._fastMusicAnalyser` fresh each render frame and never connects the media
  source (so it can't clobber the EQ path). Shared globals: `window._fastMusicAudioContext`,
  `window._fastMusicSourceMap` (WeakMap element→source), `window._fastMusicAnalyser`. EQ state
  persists in `localStorage('fastmusic_eq')`.
- `src/services/api.ts` exports a **singleton** `mediaApi = new MediaApiService()`
  (`api.ts:421`). `App.tsx` and components call it; it talks to the server via a
  `baseUrl` persisted in `localStorage` (`fastapi_base_url`). **All demo/big-data modes
  have been removed** — every method talks to the server only and returns empty results
  (`[]` / `{items:[]}`) on error. There is no client-side synthetic library anymore.
- `src/types/media.ts` holds shared types (`MediaItem`, `ArtistSummary`, `AlbumSummary`,
  `ScanResponse`, `PaginatedTracksResponse`, `RadioChannel`, `PlayMode`). Keep server
  response shapes in sync with these.
- `src/data/demoMedia.ts` has been **deleted** — there is no demo/seed media anywhere.
  The library is empty at startup and only populated by scanning real local dirs.

Server API routes (all in `server.ts`): `/api/health`, `GET|POST /api/directories`,
`POST /api/scan`, `/api/artists`, `/api/albums`, `/api/tracks` (filter + `limit/offset`
or `page/page_size` paging), `/api/radio`, `/api/tracks/:id`, `/api/stream/:id`,
`/api/transcode/:id`, `/api/lyrics`.

## Gotchas

- **README is stale/aspirational**: it tells you to set `GEMINI_API_KEY` in `.env.local`,
  but there is **no `.env.local`**, `dotenv` and `@google/genai` are declared deps yet
  **never imported or used** in any `.ts`/`.tsx`. The app runs with no Gemini key.
- **Hardcoded scan dirs** at `server.ts:48-52`:
  `/home/feifei/mnt/data_4t/KuGou/flac`, `.../youtube`, `.../youtube-music`. These are
  user-specific. Configure real dirs via `POST /api/directories` or the ServerConfigModal UI.
- **Scan is persistent + incremental** (rewritten): the library is persisted to
  `fastmusic_db.json` next to `server.ts` (`{dirs, items[]}`, atomic tmp+rename). Startup
  calls `loadDbFromDisk()` (no more `MEDIA_DB.clear()`), so a restart keeps the index.
  `POST /api/scan` is **incremental by default**: files already indexed whose `(mtimeMs,
  file_size)` are unchanged are **skipped** (no re-parse) — only new/changed files run the
  slow `music-metadata` `parseFile`. Pass `?force=1` or body `{"force":true}` to clear +
  fully re-scan. `ServerMediaItem` gained an optional `mtime` field for this dedup. The
  first full scan over ~34k files is still slow (music-metadata dominates); re-scans are fast.
- **Corrupt/unplayable files are excluded from the index**: `parseMediaFileMetadata` returns
  `decodable: false` when neither music-metadata nor ffprobe can read the file (e.g. truncated
  youtube-music `.webm` downloads whose EBML header is garbage), and `scanMultipleLibraries`
  skips them (logs `[Skip] 文件无法解码…`, counts `invalid_files`, and deletes any stale entry).
  The files themselves are NOT deleted from disk.
- **`.webm` is a video container but is listed in `AUDIO_EXTS`** (`server.ts:26`), so the
  scanner classifies every `.webm` as `media_type:'audio'` — yet youtube-music audio AND
  youtube MV videos both use `.webm`. The extension alone cannot tell them apart. The
  player therefore decides picture-vs-visualizer from `isVideo = media_type==='video' || hasVideoTrack`
  (`hasVideoTrack` = `<video>.videoWidth>0` via `player.on('loadedmetadata')` in `VideoJsPlayer.tsx`).
  `media_type` covers `.mkv/.mp4` (server already classifies them video); `hasVideoTrack` is the
  authority for `.webm` (audio-only vs MV share the ext). Both client and server send
  `video/webm` (not `audio/webm`) for `.webm` so the native element/video.js use the video
  tech; audio-only webm still decodes with `videoWidth=0` → visualizer.
- **`.mkv` MTV files are Matroska/EBML, and MOST of them are AV1 video + Opus audio** (ffprobe-confirmed:
  1a594d9ce387, 40b46e3192a7, 57418542290f, bba96809d1aa, d448a559f462, f9ed4c4d19bf = av1; only
  73aa5632b07b = h264 High + aac). Chrome has no `video/x-matroska` demuxer, and its libwebm demuxer
  **forbids h264 under webm MIME** (old MIME trick → black screen + audio). Even after remuxing to MP4,
  **this machine's Chrome renders these YouTube-sourced AV1 streams black** (audio fine) while ffmpeg/libdav1d
  decodes them normally and Chrome plays libaom-generated AV1 test files — so AV1 is not usable here.
  Current fix = **codec-aware stream remux** in `/api/stream/:id` (`server.ts`): on cache miss, ffprobe the
  source video codec (`execFileSync('ffprobe', ... codec_name ...)`), then `spawn` ffmpeg piping stdout →
  response (`Content-Type: video/mp4`, chunked, Range ignored on first request) while teeing stdout to
  `mtv_cache/<id>.mp4` (atomic tmp+rename, `crypto.randomUUID()` tmp):
  - video already `h264` → `-c copy` (pure remux, ~0% CPU, instant):
    `ffmpeg -y -i <in.mkv> -c copy -f mp4 -movflags frag_keyframe+empty_moov+default pipe:1`
  - otherwise (av1/hevc/…) → transcode to H.264, audio copied:
    `ffmpeg -y -i <in.mkv> -c:v libx264 -preset fast -crf 23 -c:a copy -f mp4 -movflags frag_keyframe+empty_moov+default pipe:1`
    (~12.5s wall for a 221s 854x480 MV; one-time per file, then cached).
  Cache staleness = cache mtime >= source mtime. Subsequent requests serve the cached `.mp4` through the
  normal HTTP 206 Range path → smooth seeking. Client `VideoJsPlayer.tsx` mime is
  **`video/mp4` for all `.mkv`/`.mp4`** (no more `video/webm` for `.mkv`); `.webm` stays `video/webm`.
  Stale artifacts in `mtv_cache/` from the old webm-remux path (e.g. `*.webm`) are simply never read again.
  Note: fragmented MP4 (`empty_moov`) makes Chrome report `duration = Infinity` at first and then
  **the end of the last buffered fragment** (e.g. 10.08 → 20.04 → 50.04 for a 199s file) until the whole
  file is buffered. So the DB must carry a real duration: `parseMediaFileMetadata` falls back to
  `probeDurationWithFfprobe()` (`server.ts`, ffprobe `format=duration`) for any `VIDEO_EXTS` file where
  music-metadata gave nothing — music-metadata does NOT parse Matroska, so all 1233 `.mkv` items had
  `duration: undefined` before. `VideoJsPlayer.tsx` seeds `duration` from `currentTrack?.duration` on
  source change (`seedDurationRef`) and `durationchange` only accepts a value `>= seed - 1`, otherwise
  the progress bar percentage is garbage. Scrub now always seeks (`handleProgressScrub` → `handleSeek`),
  not only when `!isDraggingProgress`.
- `abs_path` is now **always a local file path** (no seed items). `/api/stream/:id`
  still has a vestigial `res.redirect()` branch for `http(s)://` abs_path (`server.ts:522-523`)
  that is never hit in practice; the real path is local `fs.createReadStream` + HTTP `206`
  Range streaming.
- **歌词来自网易云明文接口**（不需要 weapi/AES）：`GET /api/lyrics?title=&artist=&duration=` 或 `?id=<网易云ID>`。
  服务端先用 `https://music.163.com/api/search/get?s=...&type=1` 找歌曲 ID，再取
  `https://music.163.com/api/song/lyric?id=...&lv=1&tv=1&rv=1`。**必须带浏览器 UA + Referer**，
  否则网易云返回空 body。搜索接口返回的 `duration` 单位是**毫秒**（打分时除以 1000）。
  结果（含"无歌词"的负结果）缓存在内存 Map 并持久化到 `fastmusic_lyrics.json`（已 gitignore）。
  客户端 `VideoJsPlayer.tsx`：`parseLrc` 解析 LRC（一行多个时间戳展开），把 `tlyric` 翻译并入同一时间轴，
  过滤 作词/作曲/原唱/【…】 这类 credits 行；高亮行 = 时间戳 <= `currentTime` 的最后一条。
  开关是控制栏的 Captions 按钮或 `L` 键，持久在 `localStorage('fastmusic_lyrics')`（默认开启）。
- **video.js copies the `<video>` element's className into its auto-created wrapper div at init, and the
  wrapper's classes never change afterwards.** `VideoJsPlayer.tsx` must keep the `<video>` classes STATIC
  (`video-js vjs-custom-theme w-full h-full`). Conditional visibility classes (e.g. `!isVideo ? 'opacity-0
  pointer-events-none absolute'`) get baked into the wrapper at first init (radio mode's first track is audio)
  → the wrapper stays `opacity-0` forever → every video track plays with sound but a BLACK viewport (this was
  the real cause of the "mkv 黑屏" reports, not the codec). Audio tracks are fine because the z-10 visualizer
  overlay covers the black wrapper.
- **Auto-advance on `ended`** (`VideoJsPlayer.tsx`): the init useEffect has deps `[]`, so it closes over the FIRST
  `onNext` prop. App recreates `handleNextTrack` every render with fresh `currentIndex`/`playMode`, so the `ended`
  handler MUST call `onNextRef.current()` (a `useRef` reassigned each render), NOT the captured `onNext` — otherwise
  it always seeks to a stale index and the queue never advances (list-repeat plays one song then stalls).
- **Progress-bar scrub** (`VideoJsPlayer.tsx`): the scrub bar div wires `onMouseDown`/`onMove`/`onUp`/`onLeave`.
  `isDraggingProgress` MUST be reset on `onMouseUp` (`handleProgressScrubEnd`) AND `onMouseLeave` — if it's only
  set true on mousedown and never cleared, the `if (!isDraggingProgress)` guards in `handleProgressScrub` and the
  `timeupdate` handler freeze the playhead after the first click (clicks appear to do nothing).
  Also: a mousedown on the scrub bar whose mouseup lands on a DIFFERENT element (e.g. the play button) leaves
  `isDraggingProgress` stuck true → audio plays (sound) but the `timeupdate` guard freezes the UI time/progress
  bar. `togglePlay` and the source-change effect MUST `setIsDraggingProgress(false)` on play start / track change.
- **`DISABLE_HMR=true`** (set by AI Studio) turns off Vite HMR and file watching
  (`vite.config.ts:14-19`) to save CPU during agent edits. Expect no live reload when it's
  set; restart the server to pick up changes.
- The `@` path alias is configured (`vite.config.ts` alias + `tsconfig.json` `paths`
  `@/* → ./*`), but **existing code uses relative imports** (`./types/media`,
  `../types/media`). Match the surrounding file's style; don't introduce `@/` imports
  into files that use relative ones.
- **Page layout is a fixed-height flex column** (`App.tsx:382` root `h-screen flex flex-col`):
  header (fixed) + `<main flex-1>` (player section fixed height + library section `flex-1`)
  + footer (fixed). The library list fills the leftover viewport and scrolls INTERNALLY
  (`LibraryView.tsx` scroll box `overflow-y-auto h-[390px]` ≈ 8 rows — a SMALL DEFINITE height so the footer
  stays on-screen; NOT `flex-1 min-h-0` which collapses/squishes rows so the list can't scroll; auto-append fires
  via the box's
  `onScroll` handler `handleScrollBox` when `scrollHeight-top-clientHeight<120`, NOT an IntersectionObserver
  — an observer with `root=scrollBoxRef` always intersects and loads the WHOLE library into the DOM, blowing up
  memory). Root also has `overflow-hidden` so the page itself can never scroll. Don't reintroduce `min-h-screen`,
  unbounded list height, or an IntersectionObserver here.

## Conventions

- Comments and UI strings are in Chinese throughout — keep new comments/messages
  consistent with that.
- No git repo here (no `.git`), so no branch/PR/commit workflow applies.
