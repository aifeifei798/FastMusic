# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格，版本号遵循语义化版本。

## Unreleased

### Added
- **Docker 部署**: `Dockerfile`（Node 22 + `ffmpeg` + `fd-find`，生产模式 serve `dist/`）、`docker-compose.yml`（媒体目录挂载 + `fastmusic_data` 持久卷）、GitHub Actions `.github/workflows/docker.yml` 自动构建并推送到 GHCR（`ghcr.io/aifeifei798/fastmusic:latest`）。
- `DATA_DIR` 环境变量：索引 / 封面缓存 / 歌词缓存的写入位置（默认与 `server.ts` 同目录），容器里设为 `/data` 并挂载卷。
- **手机（<768px）布局重构**（`src/utils/responsive.ts` 的 `useIsCompact()`）：
  - 播放器默认折叠成一条「正在播放」胶囊（封面 + 标题 / 歌手 + 时间 + 上一首 / 播放 / 下一首 + 展开），把垂直空间还给列表；展开状态持久在 `localStorage('fastmusic_player_expanded')`，全屏时始终展开。
  - 展开态音频舞台改为「唱片左 + 信息右 + 歌词横向带」两列网格（三列结构在 ~330px 舞台里会把标题挤成每行一个字）；MTV 歌词列自动收窄。
  - 播放视口与列表行支持左右滑动切歌（左滑下一首 / 右滑上一首）。
  - 页头「更多」菜单（历史 / 快捷键 / 语言），媒体类型切换收进「筛选与工具」菜单，均衡器与歌词样式面板变成全宽 sheet，控制栏适配 iOS 安全区。
- **断点续播 + 音量记忆**: 播放每 10s 记录一次位置（`localStorage('fastmusic_resume')`，最多 300 条），重新打开同一曲目时从上次的中途位置继续（只在 >10s 且离结尾 >5s 时恢复），左列显示「继续播放 0:42」提示（`aria-live="polite"`，8s 后自动消失，手动 seek 后清除）；音量持久化到 `localStorage('fastmusic_volume')`（默认 70%）。
- **全局快捷键扩展**: `Space` 播放/暂停、`←`/`→` 快退/快进 10 秒、`↑`/`↓` 音量、`M` 静音、`F` 全屏、`V` 切换频谱模式（走 `window._fastMusicPlayerControls`，与 `window._fastMusicAnalyser` 同一套路；播放器有焦点时跳过 Space / 方向键，避免 video.js 自带快捷键双重触发）。
- **频谱 canvas 按容器 × DPR 尺寸**（上限 2）而不是写死 800×360，高分屏不再发糊；暂停时降到 ~15fps，系统「减少动态效果」时同样降帧，`src/index.css` 也加了 `prefers-reduced-motion` 的 CSS 动画降级。
- **服务端稳定性**: `SIGINT` / `SIGTERM` 优雅退出（落盘索引 / 封面 / 歌词索引，kill 转码子进程，8s 兜底强制退出）；启动时清理上次被 kill 残留的 `*.fastmusic.tmp`；扫描过程中每 5s 防抖落盘一次索引（之前只在扫描结束时写一次，中途被 kill 会丢整个进度）。
- **歌手 / 专辑列表缓存**: `/api/artists` 与 `/api/albums`（按 `artist` 参数分键）的聚合结果缓存，库增删时统一失效；实测 `/api/artists` 18ms → 7ms，`/api/albums` 36ms → 18ms。

### Changed
- **`serveFileWithRange()` 重写**: 支持后缀 Range（`bytes=-N`）、越界返回 416（带 `Content-Range: bytes */size`）、非法 Range 返回 400、HEAD 只返回头、`statSync` 失败返回 404；加 `ETag` / `Last-Modified` / `Cache-Control: no-cache`（原来是 `no-store`），无 Range 请求命中 ETag 时返回 304（带 Range 的请求绝不 304，否则寻道失效）；流读取挂 `error` handler，文件被删 / IO 错误不再把进程崩掉。
- **随心电台横幅精简为一行**: 徽标 + 频率 + LIVE 在同一行，全库漫游 / 纯音专线 / MTV 视听 三个频道切换与「切台 / 换一首」改为纯图标（名称只在 tooltip），窄屏只保留徽标 + 频率；横幅不再重复显示当前歌名（下方播放器已有），横幅高度从 ~100px 降到 56px。
- **音量增强 ×2 默认开启**: 没有 `localStorage('fastmusic_boost')` 记录时 boostGain 初始为 2（默认音量仍是 70%），只有用户显式关闭过才保持关闭；窄屏控制胶囊装不下 ×2 按钮，所以开关收进均衡器面板 header。
- **频谱模式切换改为纯图标**（柱状 / 波形 / 光晕环 / 对称 / 无），名称只出现在 `title` / `aria-label`，窄屏不再换行挤乱播放区顶栏。
- **全库转码统计从列表工具栏移到「系统配置」弹窗**：新增「转码 / Remux 状态」区块（进度条 + 已就绪 / 转码中 / 排队 / 失败，弹窗打开时每 5s 轮询 `/api/transcode/summary`）；列表行内的单文件转码徽章与「只看已转码」筛选不变。
- **页头 / 页脚 / 工具栏入口改为纯图标**：随心电台、系统配置、曲目 / 歌手 / 专辑 / 收藏标签、全部 / MTV / 音乐 类型切换、筛选与工具、回到顶部都只显示图标，名称与数量（如 `曲目 30/33.9k`）只在 `title` / `aria-label` 里；窄屏（360px）页头不再溢出，"FastMusic" wordmark 与语言按钮的文字也收掉。

### Fixed
- **唱片不再静止**: 唱片旋转改用 `src/index.css` 里的语义化 `vinyl-spin` 动画（14s 一圈），系统「减少动态效果」时只放慢到 40s 一圈而不是被全局降级规则完全停掉（之前 `animate-[spin_14s_linear_infinite]` 会被杀掉，唱片看起来完全不转）；窄屏折叠胶囊里的小唱片也整张旋转（之前只有封面 img 转，黑胶环静止）。

### Changed
- **音量控件改成垂直 fader**: 控制胶囊里的横向滑块换成自下往上的垂直推杆（10×40 轨道 + 填充 + 滑块），右侧显示当前百分比（如 `75%`）；鼠标拖拽 / 点击 / 键盘 ↑↓（fader 有焦点时本地处理并 `stopPropagation`，避免与全局快捷键双重调整）都能调，`role="slider"` 带 `aria-valuenow`。
- **窄屏音量弹出面板**: 手机上 10×40 的小推杆手指没法精确调，所以窄屏的音量按钮（图标 + 百分比）改为弹一层铺满播放区的面板：自适应高度的大推杆（带 25/50/75 刻度）+ 大号数字 + 20/40/60/80/100% 预设 + −5%/+5% 微调 + ×2 增强 / 静音开关，`Esc` 或 `×` 关闭；与均衡器面板互斥（打开一个会自动关闭另一个），桌面仍用内联小推杆。

## v0.1.0 — 2026-10-12

首个公开版本。

### Added
- **扫描与索引**: 增量扫描（已索引且未变化的文件跳过）、损坏/无法解码文件自动排除、索引持久化到 `fastmusic_db.json`、`fdfind` 枚举 + `SCAN_CONCURRENCY`（默认 8）并发元数据解析。
- **浏览与搜索**: 曲目 / 歌手 / 专辑标签、防抖搜索 + 命中数、服务端排序（标题 / 歌手 / 专辑 / 时长 / 大小 / 文件日期 / 随机）、标准 / 紧凑行密度、A–Z 字母索引、随心电台、播放历史、收藏、「筛选与工具」下拉（只看已转码 / 只看有歌词 / 排序 / 行密度 / 预取封面 / 预取歌词）。
- **`.mkv` sidecar remux 引擎**: AV1/VP9 → WebM（`-c copy`），H.264/HEVC → MP4（`-c copy`），未知 codec → VP9 + Opus 转码；sidecar 缓存后走 HTTP 206 Range；启动时 `queueAllMkvTranscodes()` 预转码（`PRETRANCODE_MKV=0` 关闭）；列表行与工具栏显示转码状态，「只看已转码」筛选。
- **封面引擎**: 本地内嵌 → iTunes → 网易云三级兜底，候选按标题 / 歌手 / 专辑 / 时长打分，磁盘缓存 `covers/` + 索引 `fastmusic_covers.json`；旋转唱片（封面铺满整张唱片）；歌手 / 专辑卡片头像补全。
- **歌词**: 网易云明文接口解析 + 每曲目一个文件的磁盘缓存（`lyrics/` + `fastmusic_lyrics.json`），歌词竖列当前行居中、字号 / 列宽可调、全屏贴画面右边缘；「只看有歌词」筛选与预取。
- **音频**: 10 段 BiquadFilter 均衡器 + 预设（平 / 摇滚 / 流行 / 古典 / 电子 / 爵士）、音量增强 ×2、五种视觉模式（柱状 / 波形 / 光晕环 / 对称频谱 / 无）。
- **全库缓存任务**: `POST /api/cache/run` 四类后台任务（track_covers / artist_covers / album_covers / track_lyrics）+ `GET /api/cache/status` / `POST /api/cache/stop`，UI 在「系统配置」弹窗。
- **深浅主题**: `src/index.css` 语义 token（`@theme` + `[data-theme="light"]` 覆盖），页头 Sun/Moon 切换，`localStorage('fastmusic_theme')`，canvas 配色走 `src/utils/theme.ts`。
- **双语界面**: `src/utils/i18n.ts`（`t()` 以中文原文为 key + EN 表 + `tServerMessage()` 翻译服务端动态提示），页头 Globe 切换，`localStorage('fastmusic_lang')`，`README.en.md`。
- **品牌资源**: `public/logo*.svg` / `favicon.svg` / `docs/logo*.png` 与内联 `Logo.tsx`。
- **快捷键**: `J`/`K` 上一首/下一首、`S` 收藏、`L` 歌词、`R` 电台、`?` 面板、`Esc` 关闭。

### Changed
- 底部控制栏改为悬浮胶囊（`backdrop-blur`），全屏时自动隐藏控制栏并隐藏鼠标指针。
- 播放序列统一为「当前列表」（没有独立播放队列），切筛选 / 搜索 / 加载更多时重新锚定当前曲目位置。
- 查询缓存：`/api/tracks` 排序结果按 `sort:seed` 缓存、搜索小写字段惰性缓存、`.mkv` sidecar stat 按源路径缓存；`MEDIA_DB` 增删时统一失效。

### Removed
- 所有 demo / 合成数据模式（`src/data/demoMedia.ts` 已删除），库启动为空，只有真实扫描结果。
- 未使用的 `dotenv` / `@google/genai` / `motion` 依赖与 `bun.lock`。
