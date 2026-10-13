# FastMusic 生产镜像
# 需要 ffmpeg/ffprobe(.mkv remux/转码 + 时长探测) 与 fd-find(快速枚举扫描目录, 缺失时自动退回 JS 递归)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fd-find \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖(单独一层, 源码改动不会重装依赖)
COPY package.json package-lock.json ./
RUN npm ci

# 源码 + 静态资源
COPY index.html vite.config.ts tsconfig.json server.ts ./
COPY src ./src
COPY public ./public

# 生产构建: NODE_ENV=production 时 server.ts 直接 serve dist/
RUN npm run build

ENV PORT=3000
ENV NODE_ENV=production
# 索引 / 封面缓存 / 歌词缓存 写到挂载卷, 而不是镜像层
ENV DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx 直接执行 server.ts(项目没有编译产物 server.js)。用 node + 显式路径, 不依赖 node_modules/.bin 在 PATH 里。
# 注意: `node node_modules/tsx/dist/cli.mjs` 会 fork 一个子进程, docker stop 的 SIGTERM 只到父进程,
# 优雅退出(落盘缓存/kill 转码子进程)不会执行。这里用 preflight + loader 让 server 跑在 PID 1 本身。
CMD ["node", "--require", "./node_modules/tsx/dist/preflight.cjs", "--import", "file:///app/node_modules/tsx/dist/loader.mjs", "server.ts"]
