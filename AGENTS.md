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
`/api/transcode/:id`, `/api/lyrics`, `/api/cover/:id`, `/api/cache/run|status|stop`.

## Gotchas

- **No AI/Gemini integration**: the project originated from Google AI Studio, but the unused
  `dotenv` / `@google/genai` / `motion` deps and the `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`
  entry in `metadata.json` have been removed. There is no `.env.local` and no API key is needed.
- **Scan dirs default to empty**: `CONFIGURED_DIRS` is seeded from `MEDIA_DIRS="/a,/b"` (comma or
  semicolon separated) and then from `fastmusic_db.json`'s `dirs` array. Add real dirs via
  `POST /api/directories` or the SystemConfigModal UI (页头/页脚的「系统配置」). (`bun.lock` was also dropped — npm is the
  only toolchain; `server.sh` uses `npm install`.)
- **查询缓存（server.ts）**：`/api/tracks` 的排序结果按 `sort:seed` 缓存（`sortCache`，最多 12 条，库增删时清空），搜索用的小写字段惰性缓存（`lowerCache`，不写进 db 文件），`.mkv` sidecar 的 stat 结果按源路径缓存（`sidecarStatCache`，`srcMtime` 变化即失效，转码完成时写入）。**任何 `MEDIA_DB` 增删必须调用 `invalidateQueryCaches()`**，否则排序/搜索会返回旧数据。实测：`sort=title` 110ms→~5ms，`ready_only=1` 90ms→~3ms。
- **Scan is persistent + incremental** (rewritten): the library is persisted to
  `fastmusic_db.json` next to `server.ts` (`{dirs, items[]}`, atomic tmp+rename). Startup
  calls `loadDbFromDisk()` (no more `MEDIA_DB.clear()`), so a restart keeps the index.
  `POST /api/scan` is **incremental by default**: files already indexed whose `(mtimeMs,
  file_size)` are unchanged are **skipped** (no re-parse) — only new/changed files run the
  slow `music-metadata` `parseFile`. Pass `?force=1` or body `{"force":true}` to clear +
  fully re-scan. `ServerMediaItem` gained an optional `mtime` field for this dedup.
  Enumeration is done by the system `fdfind` (fd) via `findMediaFilesFast()` — `fdfind -H . -0
  -e <ext>… -t f <dir>`, NUL-separated, sidecars filtered by `isSidecarFile()` — with a JS
  recursive `readdirSync` fallback if fd is missing. Parsing is the real cost (~120ms/file), so
  `scanMultipleLibraries` runs a worker pool of `SCAN_CONCURRENCY` (default 8, ~5x faster).
  An incremental re-scan of the 34k-file library is ~20s.
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
- **`.mkv` MTV files are Matroska/EBML, and essentially all of them are AV1 video + Opus audio**
  (sampled 60/60 = av1; the only h264 one found is `73aa5632b07b`). Chrome has no `video/x-matroska`
  demuxer, so every `.mkv` must be converted before it can play.
  Current fix = **sidecar remux engine** in `server.ts`: `foo.mkv` → `foo.mkv.webm` written next to the
  source (atomic `foo.mkv.fastmusic.tmp` + rename). `/api/stream/:id` for `.mkv` calls
  `ensureTranscoded()`; if the sidecar is fresh (mtime >= source mtime) it is served as `video/webm`
  through the normal HTTP 206 Range path, otherwise the request blocks until the job finishes
  (`?wait=` ms, default 600000) and then serves it.
  Codec-aware (`probeCodecsAsync` + `buildFfmpegArgs`), all lossless unless noted:
  - `av1` / `vp9` → remux to `<src>.mkv.webm` (`-c copy -f webm`, ~0.4s/file, ~0 CPU). Verified in
    real Chrome: libwebm decodes these AV1 streams fine (picture + seeking both work).
  - `h264` / `hevc` → remux to `<src>.mkv.mp4` (`-c copy -f mp4`). Chrome DOES render H.264 MP4 on
    this machine — the old "MP4/H.264 黑屏" conclusion was wrong (it was the video.js wrapper
    `opacity-0` bug, see the next gotcha).
  - probe failed / other codec → VP9+Opus re-encode into WebM (`libvpx-vp9 -deadline good -crf 33`).
  Sidecars are keyed by **source path** (`transcodeJobs`), and `findFreshSidecar()` checks both
  `.mkv.webm` and `.mkv.mp4`; `isSidecarFile()` makes the scanner skip both.
  `queueAllMkvTranscodes()` runs at startup and enqueues every `.mkv` without a fresh sidecar
  (small files first, `TRANCODE_CONCURRENCY` default 3). Disable with `PRETRANCODE_MKV=0`.
  The scanner skips sidecars via `isSidecarFile()`, so they are never indexed as audio/video.
  Client `VideoJsPlayer.tsx` uses `video/webm` for `.mkv` and polls `/api/transcode/:id` only to render
  the "排队 / 转码中 x%" badge.
- **Library list shows per-`.mkv` remux status** in the 大小/操作 column (`✓ WEBM`/`✓ MP4` = ready,
  amber spinner `转码 42%`, `排队`, dashed `待转码`, red `转码失败`). The whole-library summary is NOT in
  the toolbar any more — it lives only in the 系统配置 modal («转码 / Remux 状态», `SystemConfigModal.tsx`,
  polled every 5s while the modal is open). Server side: `/api/tracks` decorates every item with
  `transcode: TranscodeInfo` via `decorateItem()`/`transcodeInfo()` (read-only, never starts a job),
  and `GET /api/transcode/summary` + `GET /api/transcode/status?ids=...` back that modal section and the
  10s per-row poll in `LibraryView.tsx` (`transcodeById` state, `tracksRef` so the interval is created once).
  Transient ffmpeg failures (killed process, deleted tmp) are retried up to 2× by
  `markTranscodeError()` before a job is marked `error`.
  A "只看已转码" toggle next to the MTV/音乐 switch sends `ready_only=1` to `/api/tracks` (server drops
  `.mkv` whose sidecar is not ready yet); it persists in `localStorage('fastmusic_ready_only')` and is
  part of `loadData`/`handleLoadMore` deps. It only affects the tracks list — the favorites tab is
  client-side and is not filtered.
  Note: music-metadata does NOT parse Matroska, so `parseMediaFileMetadata` falls back to
  `probeMediaWithFfprobe()` (async ffprobe `format=duration`) for any file where it gave
  nothing — otherwise all 1233 `.mkv` items had `duration: undefined` and the progress bar was garbage.
  `VideoJsPlayer.tsx` seeds `duration` from `currentTrack?.duration` on source change (`seedDurationRef`)
  and `durationchange` only accepts a value `>= seed - 1`. Scrub always seeks (`handleProgressScrub` →
  `handleSeek`), not only when `!isDraggingProgress`.
- `abs_path` is now **always a local file path** (no seed items). `/api/stream/:id`
  still has a vestigial `res.redirect()` branch for `http(s)://` abs_path (`server.ts:522-523`)
  that is never hit in practice; the real path is local `fs.createReadStream` + HTTP `206`
  Range streaming.
- **封面引擎（server.ts）**：三级兜底 `本地内嵌 → iTunes → 网易云`。磁盘缓存 `covers/<id>.<ext>` + 索引 `fastmusic_covers.json`（`{covers:{id:{source,ext,url,matched,fetched_at}}, misses:[id…]}`，原子 tmp+rename，写盘防抖 5s）。`resolveCover()` 顺序：内存索引 → 已查过但无封面（`coverMisses`）直接返回 null → `extractEmbeddedCover()`（第二次 `parseFile`，`skipCovers:false`；music-metadata 不解析 Matroska，所以 `.mkv/.webm` 只能靠远端）→ `itunesCandidates()` + `neteaseCandidates()` 并发，按 `scoreCoverMatch()` 打分（标题精确 100 / 包含 60，歌手一致 +40 / 部分 +25 / 不符 −40，翻唱·歌みた −30，专辑一致 +15，网易云时长 ±3s +20），阈值 65，取最高分候选下载。`GET /api/cover/:id`（`?local=1` 跳过联网，`Cache-Control: public, max-age=31536000`，`X-Cover-Source` 头）；`POST /api/cover/prefetch`（≤200 ids，并发 8）。**列表行只有 `cover_url` 已缓存时才渲染 `<img>`**（`decorateItem()` 只读索引，不联网），所以列表不会触发网络；播放器中间列的唱片始终请求 `/api/cover/:id`（请求本身触发解析）。网易云搜索结果里的 album 只有 `picId`，需要 `neteaseAlbumPic(albumId)` 再查 `/api/v1/album/{id}`（按 album id 缓存，每曲目最多 3 次）。唱片在 `VideoJsPlayer.tsx` 的中间列（不在 `AudioVisualizer`），所以频谱模式选 `none` 时仍然旋转。**有封面时封面铺满整张唱片**（`img absolute inset-0 rounded-full object-cover` 淡入，上面叠加半透明黑胶纹路 + 外缘暗环 + 中心 spindle 孔），没封面时退回黑胶纹路 + 中心渐变标签占位。坑：浏览器缓存命中时 `onLoad` 可能不再触发，所以 `coverImgRef` + `img.complete && naturalWidth>0` 的 effect 兜底是必要的，否则 `coverLoaded` 永远 false（唱片只显示占位）。**歌手/专辑卡片封面补全**：`/api/artists`、`/api/albums` 每条带 `cover_track_id`（已缓存封面曲目 id，否则任意一条代表曲目），`LibraryView.tsx` 的 effect 对当前渲染的 120 张卡片批量 `POST /api/cover/prefetch`（`entityCoverRequestedRef` 去重），头像用 `entityCover()` 取 `avatar_url/cover_url` 或预取回来的 URL，工具栏显示「封面补全：命中 X / N」。
- **歌词来自网易云明文接口**（不需要 weapi/AES）：`GET /api/lyrics?title=&artist=&duration=` 或 `?id=<网易云ID>`。
  服务端先用 `https://music.163.com/api/search/get?s=...&type=1` 找歌曲 ID，再取
  `https://music.163.com/api/song/lyric?id=...&lv=1&tv=1&rv=1`。**必须带浏览器 UA + Referer**，
  否则网易云返回空 body。搜索接口返回的 `duration` 单位是**毫秒**（打分时除以 1000）。
  结果（含"无歌词"的负结果）缓存在内存 Map，索引持久化到 `fastmusic_lyrics.json`（`{lyrics:{key:{found,file,fetched_at}}}`），
  **歌词文本本身存 `lyrics/<md5(key)>.json`**（每条目一个文件，避免 30k+ 歌词把索引 JSON 撑爆内存；旧的内联文本格式在启动时自动迁移）。
  坑：`loadLyricCache()` 不能用 `v.found && v.lyric` 判断命中（新索引里没有 `lyric` 字段），否则重启后所有命中条目会被写成 miss；
  现在用 `Boolean(v.found) || fs.existsSync(file)` 自愈。
  解析逻辑是可复用的 `resolveLyrics(title, artist, duration)`（`lyricInFlight` 做同 key 并发去重，
  写盘防抖 `scheduleLyricSave()` 5s）；先搜 "标题 歌手"，命中（score ≥ 60）即返回，否则再只搜标题，
  瞬时网络错误重试一次。**网易云对高频请求会限流（连接被重置）**，所以 `POST /api/lyrics/prefetch`
  （`{ids:[…]}`，≤200 ids）并发只有 3 且每条之间 sleep 200ms（200 条约 40s）。
  `/api/tracks` 的 `has_lyrics=1` 筛选只读歌词缓存（不联网），前端开关持久在 `localStorage('fastmusic_has_lyrics')`；
  工具栏「预取歌词」按钮预取当前已加载列表，结果通过 `onLyricStatus` 回调 patch `tracks` 的 `lyric` badge。
  客户端 `VideoJsPlayer.tsx`：`parseLrc` 解析 LRC（一行多个时间戳展开），过滤 作词/作曲/原唱/【…】 这类 credits 行；
  播放区域是**网格舞台**（必须 `gridTemplateRows:1fr` + 列 `min-w-0 min-h-0`，否则 grid 的 1fr 会被内容撑高到
  整篇歌词高度）：**音频** = 三列 `grid-cols-[1fr_240px_1fr]`（左列右对齐 = 歌名/歌手/专辑，中间 240px 留空给唱片
  并两侧 hairline 分隔，右列 = 歌词竖列）；**MTV/视频** = 两列，列宽用 **inline style**
  `gridTemplateColumns: 1fr ${effectiveLyricWidth}px`（见下面 Tailwind 坑），左侧信息列与唱片留空区
  不渲染（画面是主角，歌名/歌手/专辑仍出现在顶部控制栏与下方上下文卡片），歌词竖列贴右边缘
  （必须显式 `col-start-2`，否则唯一网格项会落到第一列即左侧），并有一层从左到右渐隐的暗底保证可读。
  **坑**: Tailwind 的 arbitrary class 是静态扫描生成的，`grid-cols-[1fr_${n}px]` 这种带运行时插值的写法
  **不会生成任何 CSS 规则**（实测 `document.styleSheets` 里没有 `grid-cols-[1fr_…` 规则），浏览器退化成隐式
  grid 轨道，歌词列宽度完全失控。所以动态列宽必须写 inline style；静态字面量（如 `grid-cols-[1fr_240px_1fr]`）没问题。
  歌词竖列**贴紧画面右边缘**：舞台 grid 的 `padding-right` 由 `updateLyricRightInset()` 算出
  （容器右缘到 `<video>` 右缘 + 画面居中产生的 letterbox 黑边），在 `loadedmetadata`、
  `fullscreenchange` 和容器 `ResizeObserver` 时重算；全屏时 ≈0 → 贴屏幕右缘，普通/剧场模式
  画面比容器窄时歌词会左移贴画面边缘而不是悬在黑色上。
  当前行始终居中：`lyricBoxRef` 是 `relative`，effect 用
  `el.offsetTop - box.clientHeight/2 + el.offsetHeight/2` 算出 `lyricOffset`，内层 div `translateY(-offset)`
  （offset 可为负，前奏时列表需下移），上下行按距离淡出，窗口上下边缘用 Tailwind arbitrary property `[-webkit-mask-image:linear-gradient(...)]` 渐隐（歌词行没有自定义 CSS 类，全是 utility 类；字号是动态值，用 inline `style={{ fontSize }}`）
  歌词用 Noto Serif CJK SC 衬线体；控制栏的 "Aa" 按钮打开歌词样式面板（字号 12/14/17 → `localStorage('fastmusic_lyric_font')`，视频时歌词列宽 240/340/420 → `localStorage('fastmusic_lyric_width')`）。
  实际列宽是 `effectiveLyricWidth = max(200, min(lyricWidth, round(stageWidth * 0.26)))`（`stageWidth` = 舞台容器宽 − `lyricRightInset`），
  所以剧场模式画面窄时歌词列自动收窄，全屏时保持用户选择；面板在被封顶时显示「舞台宽度有限，歌词列自动收窄到 Npx」。
  开关是控制栏的 Captions 按钮或 `L` 键，持久在 `localStorage('fastmusic_lyrics')`（默认开启）。
- **系统配置弹窗 = 扫描 + 全库缓存的唯一入口**（`src/components/SystemConfigModal.tsx`，原名 ServerConfigModal；页头和页脚都有「系统配置」按钮，页脚的「重新扫描」按钮已删除，重扫只在弹窗里做）。弹窗顺序：四个全库缓存任务 → 转码 / Remux 状态（全库 .mkv 汇总，5s 轮询 `/api/transcode/summary`，列表工具栏不再显示） → 连接配置 → 扫描目录 → 策略说明。任务由服务端后台跑（`POST /api/cache/run {kind}`，`GET /api/cache/status`，`POST /api/cache/stop`），kind 是 `track_covers` / `artist_covers` / `album_covers` / `track_lyrics`；`buildJob()` 重建队列时跳过已缓存 / 已查过无结果的条目，所以重复启动只补齐新增内容。歌手/专辑任务用 `artistTargets()` / `albumTargets()`（每个歌手/专辑取一条代表曲目，优先已缓存封面的曲目）。进度字段 `done/hits/misses/errors/remaining/etaSeconds`，ETA 只统计本次真正联网的条目（`startDone`），所以不会把已缓存的条目算进速率。手动停止后 `stopped=true`，UI 显示「已停止 · 剩余 N 条」而不是「已完成」。节流：封面并发 8 + 80ms，歌词并发 3 + 200ms（env `COVER_PREFETCH_CONCURRENCY` / `COVER_PREFETCH_DELAY_MS` / `LYRIC_PREFETCH_CONCURRENCY` / `LYRIC_PREFETCH_DELAY_MS`）。工具栏的「预取封面 / 预取歌词」只处理当前已加载列表（≤200 条），全库任务在系统配置里。
- **底部控制栏是悬浮胶囊**（`VideoJsPlayer.tsx`）: `absolute bottom-3 left-1/2 -translate-x-1/2 w-full max-w-[min(100%,900px)] rounded-xl bg-neutral-900/45 backdrop-blur-md`，
  不占布局高度。之前是整条 `bg-gradient-to-t from-neutral-950` 的 108px 近纯黑带，全屏时会被看成
  画面下方的"大黑边"。均衡器面板因此锚定在 `bottom-[104px]`（胶囊高约 84px + bottom-3）并加
  `max-h-[calc(100%-112px)] overflow-y-auto`，slider 高度 `h-24`，否则短舞台（~335px）里面板会被裁掉。
- **全屏沉浸隐藏鼠标指针**: 控制栏自动隐藏（播放中 3.5s 无鼠标移动 / 鼠标离开播放区）后，
  全屏视频时 `cursor-none` 挂在**全屏根容器**（`VideoJsPlayer.tsx` 的 `containerRef` div，
  条件 `isFullscreen && isVideo && !showControls`）而不是只挂播放视口 div：舞台 overlay
  （`absolute inset-0 z-[15] pointer-events-none`）、控制胶囊、歌词列都是根容器的直接子元素，
  浏览器按指针下方最上层元素解析 cursor，只给视口 div 加 `cursor-none` 时这些区域仍显示指针
  （这就是"控制栏隐藏后鼠标没隐藏"的原因）。`cursor` 是继承属性，根容器设 none 后视口 div、
  video.js wrapper/`<video>`、overlay、胶囊、歌词列全部继承。视口 div 仍保留条件类
  （隐藏时 `cursor-none`，否则 `cursor-pointer`），否则 `cursor-pointer` 会覆盖继承的 none。
  控制栏可见时恢复 `cursor-pointer`（方便点击按钮）。实测（CDP 计算样式）：根容器/视口/wrapper/
  `<video>`/胶囊/歌词列的 computed cursor 都是 `none`。
- **界面语言（i18n）**: `src/utils/i18n.ts` 导出 `getLang()/setLang()/isEn()/t(key, vars?)`，**key 就是中文原文**（含 `{n}` 占位符），英文在 `EN` 表里查；未收录的 key 原样返回中文，所以新增文案不会崩。语言持久化到 `localStorage('fastmusic_lang')`（默认 `zh`），`index.html` 的内联脚本首屏前写 `<html lang>`。`App.tsx` 有 `lang` state + 页头 Globe 按钮（`handleToggleLang`），切语言后全站重渲染。坑：
  - 模块级常量（`EQ_PRESETS` 的 label、`CACHE_JOBS` 的 title/hint）在 import 时无法翻译，必须**渲染时** `t(p.label)` / `t(task.title)`。
  - 服务端返回的中文字符串（`未知艺术家`、`精选集`、`/api/cover` 与 `/api/lyrics` 的 `detail`、`scanResult.message`）走 `t()` 精确匹配；含动态数字的模板用 `tServerMessage()`（先正则匹配模板再填占位符），例如 `扫描完成：新增 N，复用 M，库共 K 条目`。新增服务端文案时同步加 key。
  - 中文媒体标题/歌手名不是 UI 文案，保持原样。
- **深浅主题（theme tokens）**: 全站颜色都是 `src/index.css` 里的语义 token —— `@theme` 块定义深色默认值（`app / surface / surface-2 / elevated / line / line-strong / line-soft / ink / ink-2 / ink-3 / muted / muted-2 / faint / accent / accent-soft / accent-dim / amber / amber-dim / emerald / emerald-dim / sky / sky-dim / danger / danger-dim / purple / purple-dim / stage / viewport / vinyl / lyric-ink / pill`），`[data-theme="light"]` 只覆盖变量值，组件类名不变。**新代码不要写 `neutral-950` / `rose-400` 这类硬编码色**（`bg-black/75` 弹窗遮罩、accent 按钮上的 `text-white` 是例外）。主题状态：`localStorage('fastmusic_theme')`（默认跟随 `prefers-color-scheme`），`App.tsx` 的 effect 写 `document.documentElement.dataset.theme`；`index.html` 的内联脚本在首屏前读 localStorage 设置 `data-theme`，避免 FOUC。坑：
  - canvas / JS 里的颜色不走 token：`src/utils/theme.ts` 的 `currentTheme()` + `VISUALIZER_PALETTE`（含 `glowScale`，浅色主题光晕减半）+ `coverGradient()`，`AudioVisualizer` 每帧读一次，切主题后自动变。
  - 视频相关：`bg-viewport`（`<video>` 视口）两个主题都保持深色（浅色主题 `#101014`），只有舞台 `bg-stage` 变浅；压在画面上的歌词文字永远用 `text-lyric-ink`（浅色文字 + 暗底 scrim），音频歌词用 `text-ink` + `var(--lyric-shadow)`。
  - 控制胶囊用 `bg-pill`（深色半透明暗玻璃 / 浅色半透明白玻璃）。
- **品牌徽标（Logo）**: 页头/页脚的徽标是内联 SVG 组件 `src/components/Logo.tsx`（渐变圆角方 + 黑胶同心纹路 + 白色闪电），几何与 `public/logo-mark.svg`、`public/favicon.svg`（16px 简化版：无内圈纹路、闪电加粗）一致 —— 改形状时三处要同步。`public/` 是 Vite 默认静态目录（dev 直接 served，build 后拷进 `dist/`），`/favicon.svg`、`/logo.svg`（白色文字 lockup，深色页面用）、`/logo-dark.svg`（深色文字 lockup，浅色页面用）、`/logo-light.svg`（Apple 风浅色主题 lockup：近黑徽标 `#1d1d1f` + 近黑 wordmark，无渐变）、`/logo-mark-light.svg`、`/logo-mark-mono.svg` / `/logo-mark-line.svg`（`currentColor` 单色 / 线条版）都可直接访问；`index.html` 的 `<link rel="icon">` 与 `og:image` 指向它们 / `docs/logo.png`（另有 `docs/logo-light.png`、`docs/logo-dark.png`、`docs/logo-light-lockup.png`、`docs/logo-mark-light.png` 位图导出）。
- **样式全部用 Tailwind utility 类**: `src/index.css` 只有两个 `@import`（tailwindcss + video.js 官方 CSS），
  没有手写规则。滚动条用 arbitrary variant 挂在每个滚动容器上（共享常量 `SCROLLBAR_CLASSES` /
  `NO_SCROLLBAR_CLASSES` 在 `src/utils/ui.ts`，因为 `::-webkit-scrollbar` 伪元素不能从祖先继承）。
  坑: video.js 运行时注入 `<style class="vjs-styles-defaults">`（`.video-js { width:300px; height:150px }`），
  它不在任何 `@layer` 里，优先级高于 Tailwind 的 utilities layer，所以对 video.js 的覆盖必须加 `!`
  后缀（如 `[&_.vjs-custom-theme]:w-full!`），否则 wrapper 只有 300px 宽 → 画面被挤成窄条。
- **列表排序与行密度**: 工具栏的 `<select>` 走服务端 `sort` 参数（`default|title|artist|album|duration|size|mtime|random`，
  random 用 `seed` + `hashString`），持久在 `localStorage('fastmusic_sort')`；`default` 时 App 不传 sort。
  行密度按钮（标签显示当前模式：标准/紧凑）持久在 `localStorage('fastmusic_density')`，紧凑行 `py-1.5` + 24px 封面，
  专辑列换成时长列。工具栏是 `flex-wrap`，窄屏不会溢出。搜索防抖后工具栏显示「命中 N」。
  **只看已转码 / 只看有歌词 / 排序 / 行密度 / 预取封面 / 预取歌词 都收进「筛选与工具」下拉**（`LibraryView.tsx`
  的 `toolMenuOpen` + `toolMenuRef`）：面板 `absolute top-full right-0 z-40 w-[360px]`（用 `right-0` 而不是 `left-0`，
  靠右的工具栏会让 `left-0` 的面板溢出视口右缘），点外部或 `Esc` 关闭；当前生效的筛选用小图标表示（`CheckCircle2`
  绿色 = 只看已转码，`Captions` 蓝色 = 只看有歌词），文字只在 `title` 里。
  **页头/页脚/工具栏的入口都是纯图标**（随心电台 `Radio`、系统配置 `Server`、标签 `ListMusic`/`User`/`Disc`/`Heart`、
  媒体类型 `Layers`/`Film`/`Music`、筛选与工具 `SlidersHorizontal`、回到顶部 `ArrowUp`），名称与数量只在
  `title` / `aria-label`（标签的 `title` 是 `曲目 30/33.9k`），`fmtNum()` 只出现在 tooltip 与列表页脚。
  坑：lucide 的 `LucideProps` 类型不接受 `title`，给图标加 tooltip 必须包一层 `<span title=…>`。
  页头在 <640px 时隐藏 "FastMusic" wordmark（`hidden sm:inline`），语言按钮也是纯图标（Globe），否则 360px 视口会溢出。
- **快捷键**: `J`/`K` 上一首/下一首（走 `prevNextRef` 避免闭包里的旧 index），`S` 收藏当前曲目，`L` 歌词开关，
  `R` 随心电台，`?` 打开快捷键面板，`Esc` 关闭。之前 `L` 同时绑定收藏和歌词，所以收藏改成 `S`。
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
- **播放序列 = 当前列表（没有独立"播放队列"）**: `App.tsx` 里 `playlist` 就是正在浏览的列表
  (`isRadioMode ? radioQueue : libraryActiveTab === 'favorites' ? favorites : tracks`)，
  `currentTrack` 是独立 state，`currentIndex` 只是它在 `playlist` 里的位置（`-1` = 不在当前列表，
  例如切筛选后）。切筛选/搜索/加载更多/切标签时一个 effect 用 `findIndex` 重新锚定 `currentIndex`，
  所以"下一首"永远是列表里的下一条（MTV 筛选 → 下一个 MV；音乐筛选 → 下一首歌；收藏标签 → 下一个收藏）。
  `handleNextTrack` 播到列表末尾且 `hasMore` 时先 `handleLoadMore()` 再播新加载的第一条，不会回到开头。
  `PlayQueueModal.tsx` 已删除，列表行的 "+" 按钮和头部的"播放队列"按钮都没有了。
  `loop-one`（单曲循环）由 `VideoJsPlayer` 的 `ended` 处理器（读 `playModeRef`）`currentTime(0)+play()` 重播，
  App 的 `handleNextTrack` 在 `loop-one` 时直接 return。
- **频谱模式有"无"**: `VideoJsPlayer.tsx` 的视觉模式切换（柱状频谱 / 波形图 / 光晕环 / 对称频谱 / **无**）
  持久在 `localStorage('fastmusic_visualizer')`。模式列表是模块级 `VISUALIZER_MODES`（mode + lucide icon +
  label/hint），渲染时**只显示图标**（文字在手机上会把顶栏挤成多行），名称走 `title` / `aria-label`；
  新增模式时改这个数组即可，i18n 表需要对应的 label/hint key。选 `none` 时 `AudioVisualizer` 完全不挂载（舞台纯黑，
  只剩左侧信息列与右侧歌词列），所以 `AudioVisualizer` 的 canvas 不存在 — 不要假设音频曲目一定有 canvas。
  列表工具栏里的"随心电台"按钮已删除（`LibraryView.tsx` 不再接收 `onStartRadio`），电台入口只剩页头
  的 nav 链接与"随心电台/电台广播中"按钮，以及 `R` 键。搜索框不再被 `max-w-xl` 限制，而是 `flex-1`
  填满 tabs 与筛选控件之间的剩余宽度（tabs 组 `shrink-0`）。
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
  header (fixed) + `<main flex-1 min-h-0>` (player section viewport-responsive height + library section `flex-1`)
  + footer (fixed). Every tab scrolls INTERNALLY inside its own box: the tracks list, the favorites rows and the
  artists/albums grids all use `overflow-y-auto flex-1 min-h-[140px]`. The `min-h-[140px]` floor is what keeps
  rows/cards from being squished and the footer on-screen (a bare `flex-1 min-h-0` collapses the box). Tracks
  auto-append via the box's `onScroll` handler `handleScrollBox` when `scrollHeight-top-clientHeight<120`, NOT an
  IntersectionObserver — an observer with `root=scrollBoxRef` always intersects and loads the WHOLE library into
  the DOM, blowing up memory. Root also has `overflow-hidden` so the page itself can never scroll. Don't
  reintroduce `min-h-screen`, unbounded list height, or an IntersectionObserver here.
  播放器下方没有「正在播放」信息行（歌名/歌手/专辑在舞台左列，收藏按钮在控制胶囊里，格式与转码状态在
  列表行里），省下的高度全部给 `flex-1` 的库区；不要把它加回来。
- **Artists / Albums tabs batch-render**: all 6k artists / 15k albums are fetched at startup, but the grid only
  renders the first `artistLimit` / `albumLimit` cards (start 120, +120 when the grid scroll box nears the bottom
  via `handleGridScroll` + `gridBoxRef`), plus a 加载更多 button. The A-Z letter index and the toolbar search box
  both filter these lists client-side (`filteredArtists` / `filteredAlbums` memos), and a small select beside the
  count sorts them by name or by track count (`entitySort`).

## Conventions

- Comments and UI strings are in Chinese throughout — keep new comments/messages
  consistent with that.
- No git repo here (no `.git`), so no branch/PR/commit workflow applies.
