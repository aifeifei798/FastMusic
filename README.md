# FastMusic

本地音乐 / MTV 流媒体播放器。**React SPA + Express 媒体后端**,扫描本地音乐目录,通过 HTTP Range 流式播放,自带实时频谱可视化与 10 段均衡器。

```
浏览器 (React SPA)  ⇄  Express (server.ts)  ⇄  本地音乐目录
                        │
                        ├─ 增量扫描 + 持久化索引 (fastmusic_db.json)
                        ├─ .mkv → MP4 remux / VP9 转码 sidecar
                        └─ /api/stream/:id (HTTP 206 Range 流式)
```

## ✨ 功能

- **媒体库扫描**: 增量扫描(已索引且未变化的文件跳过),损坏/无法解码的文件自动排除;索引持久化,重启不丢。
- **浏览与搜索**: 按歌手 / 专辑 / 曲目浏览,关键词搜索,分页加载,字母索引,随心电台,播放历史,收藏。
- **MTV 播放**: Chrome 无法直接解析 Matroska(`.mkv`)容器,服务端按视频 codec 自动处理:
  - 视频已是 **H.264** → 纯 remux 到 MP4(`-c copy`,秒级,几乎零 CPU);
  - 视频为 **AV1/HEVC** 等 → 转码为 VP9 WebM(一次性,缓存 sidecar `*.mkv.webm`);
  - 缓存命中后走普通 206 Range 流,支持平滑 seek。
- **音频播放**: 视频.js 音频图 `source → 10 段 BiquadFilter EQ → boostGain → analyser → destination`;条形 / 光晕环 / 对称 EQ 三种频谱可视化;EQ 状态持久化到 localStorage。
- **音量增强 ×2**: 默认音量 70%,音量滑块旁有 ×2 增强开关(靠音频图里的 GainNode 实现,状态持久化到 localStorage `fastmusic_boost`)。
- **控制栏自动隐藏**: 播放中 3.5 秒无鼠标操作自动隐藏,鼠标进入播放区重新显示,离开立即隐藏(音频与视频统一)。

## 🚀 快速开始

**前置条件**

- Node.js 18+
- `ffmpeg` 与 `ffprobe` 在 PATH 中(用于 `.mkv` remux/转码与时长探测)

```bash
./server.sh start        # 自动 npm install, 后台运行, 健康检查 /api/health
```

打开 `http://localhost:3000`,在「服务器配置」里添加音乐目录,然后点扫描。

其他命令:

```bash
./server.sh stop | restart | status | logs | install
```

## ⚙️ 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口 |
| `PRETRANCODE_MKV` | 开启 | 设为 `0` 时禁用启动后的 mkv 后台预转码队列(按需转码仍生效) |
| `NODE_ENV` | dev | `production` 时服务预构建的 `dist/`,否则内嵌 Vite dev server |

扫描目录通过 UI(ServerConfigModal)或 `POST /api/directories` 配置。

## 📂 目录结构

```
server.ts              # 单入口: API + 流式服务 + 转码引擎
server.sh              # 部署脚本 (start/stop/restart/status/logs)
src/
  main.tsx / App.tsx   # SPA 入口, 中央 UI 与播放/库状态
  components/
    VideoJsPlayer.tsx  # 播放器 + 音频图 (EQ/analyser) + 控制栏
    AudioVisualizer.tsx# 频谱可视化 (纯消费者, 读 window._fastMusicAnalyser)
    LibraryView.tsx    # 媒体库列表 (内部滚动 + 增量加载)
    ...
  services/api.ts      # 客户端 API 单例
  types/media.ts       # 共享类型, 与 server 响应形状一致
```

## 🔌 API

| 路由 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/directories` / `POST /api/directories` | 列出 / 添加扫描目录 |
| `POST /api/scan` | 增量扫描;`?force=1` 清空并全量重扫 |
| `GET /api/artists` | 歌手列表(含封面) |
| `GET /api/albums` | 专辑列表 |
| `GET /api/tracks` | 曲目列表,支持过滤 + `limit/offset` 或 `page/page_size`;`ready_only=1` 只返回可直接播的条目(非 `.mkv` 或 sidecar 已就绪) |
| `GET /api/radio` | 随心电台 |
| `GET /api/tracks/:id` | 曲目详情 |
| `GET /api/stream/:id` | 流式播放(206 Range;`.mkv` 自动 remux/转码) |
| `GET /api/transcode/:id` | 转码任务状态(前端显示进度) |
| `GET /api/transcode/summary` | 全库 `.mkv` 换容器进度汇总:`{total_mkv, ready, running, queued, pending, error}` |
| `GET /api/transcode/status?ids=a,b,c` | 批量只读状态(列表每 10s 轮询,不触发转码) |
| `GET /api/lyrics` | 网易云歌词代理:`?title=&artist=&duration=`(自动搜索匹配)或 `?id=<网易云歌曲ID>`;返回 `{found, lyric, tlyric, romalrc}` |

## 📝 已知事项

- 音乐文件本身不在仓库内;索引 `fastmusic_db.json`、转码缓存 `mtv_cache/`、日志均已 gitignore。
- `.webm` 既是音频容器也是视频容器:服务端按实际解码结果分类,客户端用 `videoWidth > 0` 判断画面 vs 频谱。
- 首次全量扫描较慢(music-metadata 逐文件解析);后续增量扫描很快。
- 歌词来自网易云明文接口(`music.163.com/api/song/lyric`),服务端代理 + 缓存(`fastmusic_lyrics.json`,已 gitignore);本地曲库标题/歌手若与网易云不一致,可能匹配到翻唱版本或无歌词。
- 无测试套件;`npm run lint` 即 `tsc --noEmit`。
