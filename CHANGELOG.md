# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格，版本号遵循语义化版本。

## Unreleased

### Added
- **Docker 部署**: `Dockerfile`（Node 22 + `ffmpeg` + `fd-find`，生产模式 serve `dist/`）、`docker-compose.yml`（媒体目录挂载 + `fastmusic_data` 持久卷）、GitHub Actions `.github/workflows/docker.yml` 自动构建并推送到 GHCR（`ghcr.io/aifeifei798/fastmusic:latest`）。
- `DATA_DIR` 环境变量：索引 / 封面缓存 / 歌词缓存的写入位置（默认与 `server.ts` 同目录），容器里设为 `/data` 并挂载卷。

### Changed
- **频谱模式切换改为纯图标**（柱状 / 波形 / 光晕环 / 对称 / 无），名称只出现在 `title` / `aria-label`，窄屏不再换行挤乱播放区顶栏。

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
