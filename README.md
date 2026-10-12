# FastMusic

本地音乐 / MTV 流媒体播放器: React SPA + Express 媒体后端,扫描本地音乐目录,通过 HTTP 流式播放。

## 快速开始

**前置条件:** Node.js 18+, 以及 `ffmpeg` / `ffprobe`(用于 `.mkv` remux/转码与时长探测)。

```bash
./server.sh start        # 自动 npm install, 后台运行, 健康检查 /api/health
```

默认端口 `3000`(可用 `PORT=...` 覆盖)。其他命令: `stop | restart | status | logs | install`。

## 功能

- **库扫描**: 扫描配置的本地目录(增量扫描, 索引持久化到 `fastmusic_db.json`); 无法解码的损坏文件自动跳过。
- **浏览**: 歌手 / 专辑 / 曲目列表, 搜索, 分页。
- **MTV 播放**: Chrome 无法直接 demux Matroska(`.mkv`), 服务端按 codec 处理:
  - 视频已是 H.264 → 纯 remux 到 MP4(`-c copy`, 秒级);
  - 否则(如 AV1) → 转码为 VP9 WebM(一次性, 缓存到 `mtv_cache/`)。
- **音频播放**: 实时频谱可视化(条形 / 光晕环 / 对称 EQ) + 10 段均衡器(EQ 状态存 localStorage)。

## 架构

```
server.ts          # 单入口: API + 流式服务; dev 模式内嵌 Vite, 生产模式服务 dist/
server.sh          # 部署脚本 (start/stop/restart/status/logs)
src/
  App.tsx          # 中央 UI + 播放/库状态
  components/      # VideoJsPlayer (音频图: source → EQ → analyser), AudioVisualizer, LibraryView ...
  services/api.ts  # 客户端 API 单例
  types/media.ts   # 共享类型 (与 server 响应形状保持一致)
```

## API

| 路由 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET/POST /api/directories` | 列出 / 添加扫描目录 |
| `POST /api/scan` | 增量扫描(`?force=1` 全量重扫) |
| `GET /api/artists` `/api/albums` `/api/tracks` | 浏览 + 过滤 + 分页 |
| `GET /api/radio` | 随心电台 |
| `GET /api/stream/:id` | 流式播放(206 Range; `.mkv` 走 remux/转码 sidecar) |

## 注意

- 音乐文件本身不在仓库内: 索引 `fastmusic_db.json`、转码缓存 `mtv_cache/` 均已 gitignore。
- 扫描目录可在 UI(ServerConfigModal)或 `POST /api/directories` 配置。
