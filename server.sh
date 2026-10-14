#!/usr/bin/env bash
# ==============================================================================
# FastMusic - 服务管理脚本 (支持 启动 / 停止 / 重启 / 状态 / 日志 / 自动安装依赖)
# 用法:
#   ./server.sh start    - 启动服务 (首次运行自动安装依赖并后台运行)
#   ./server.sh stop     - 停止服务
#   ./server.sh restart  - 重启服务
#   ./server.sh status   - 查看服务运行状态
#   ./server.sh logs     - 查看实时日志
#   ./server.sh install  - 强制安装/更新依赖
# 监听地址/端口 (环境变量或命令行参数, 参数优先级高于环境变量):
#   HOST=127.0.0.1 PORT=8080 ./server.sh start
#   ./server.sh start --host 127.0.0.1 --port 8080
# ==============================================================================

set -e

# 定位脚本所在根目录并进入
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/.server.pid"
LOG_FILE="$SCRIPT_DIR/server.log"
STATE_FILE="$SCRIPT_DIR/.server.info"
HOST="${HOST:-}"
PORT="${PORT:-}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印带颜色的信息
info() {
  echo -e "${CYAN}[FastMusic]${NC} $1"
}

success() {
  echo -e "${GREEN}[FastMusic] ✔${NC} $1"
}

warn() {
  echo -e "${YELLOW}[FastMusic] ⚠${NC} $1"
}

error() {
  echo -e "${RED}[FastMusic] ✖${NC} $1"
}

# 解析命令与 --host / --port (参数顺序无关, 选项优先级高于环境变量)
COMMAND=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host)
      if [ $# -lt 2 ]; then error "--host 需要地址"; exit 1; fi
      HOST="$2"
      shift 2
      ;;
    --host=*)
      HOST="${1#--host=}"
      shift
      ;;
    --port)
      if [ $# -lt 2 ]; then error "--port 需要端口"; exit 1; fi
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#--port=}"
      shift
      ;;
    start|stop|restart|status|logs|log|install|help|-h|--help)
      COMMAND="$1"
      shift
      ;;
    *)
      error "未知参数: '$1' (支持 --host <地址> --port <端口>)"
      exit 1
      ;;
  esac
done

# 未显式指定时沿用上次启动的监听地址
if [ -z "$HOST" ] || [ -z "$PORT" ]; then
  if [ -f "$STATE_FILE" ]; then
    read -r saved_host saved_port < "$STATE_FILE" 2>/dev/null || true
    if [ -z "$HOST" ]; then HOST="${saved_host:-0.0.0.0}"; fi
    if [ -z "$PORT" ]; then PORT="${saved_port:-3000}"; fi
  fi
fi
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  error "无效端口: '$PORT' (应为 1~65535)"
  exit 1
fi

# 健康检查地址: 0.0.0.0 / :: 监听时用 127.0.0.1 探测
check_host="$HOST"
if [ "$HOST" = "0.0.0.0" ] || [ "$HOST" = "::" ] || [ "$HOST" = "*" ]; then
  check_host="127.0.0.1"
fi

# 检查环境环境 (Node.js 与 npm)
check_env() {
  if ! command -v node >/dev/null 2>&1; then
    error "未找到 Node.js，请先安装 Node.js (推荐 v18+ 或 v20+) 后再运行本脚本！"
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    error "未找到 npm，请确认 Node.js 安装完整！"
    exit 1
  fi
}

# 自动安装依赖
auto_install() {
  check_env
  if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ] && [ ! -d "node_modules/express" ]; then
    info "检测到尚未安装项目依赖，正在自动执行 npm install (可能需要 1~2 分钟)..."
    npm install
    success "项目依赖安装完成！"
  fi
}

# 判断某个 PID 是否真的是 FastMusic 服务 (端口可能被其他程序占用)
is_fastmusic_pid() {
  local pid="$1"
  if [ -z "$pid" ]; then
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  local cmd=""
  if [ -r "/proc/$pid/cmdline" ]; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  else
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  fi

  case "$cmd" in
    *server.ts*|*tsx*|*npm*run*dev*) return 0 ;;
    *) return 1 ;;
  esac
}

# 获取当前运行中的进程 PID (通过 PID 文件或端口匹配)
get_running_pid() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    local saved_pid
    saved_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if is_fastmusic_pid "$saved_pid"; then
      pid="$saved_pid"
    fi
  fi

  # 如果 PID 文件失效或不存在，尝试根据监听端口检索
  if [ -z "$pid" ]; then
    if command -v lsof >/dev/null 2>&1; then
      pid=$(lsof -t -i :"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)
    elif command -v fuser >/dev/null 2>&1; then
      pid=$(fuser "$PORT"/tcp 2>/dev/null | tr -d ' ' || true)
    elif command -v ss >/dev/null 2>&1; then
      pid=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -n 1 || true)
    fi
    if ! is_fastmusic_pid "$pid"; then
      pid=""
    fi
  fi

  echo "$pid"
}

# 启动服务
start_server() {
  check_env
  auto_install

  local current_pid
  current_pid=$(get_running_pid)

  if [ -n "$current_pid" ]; then
    warn "FastMusic 服务已经在运行中 (PID: $current_pid)"
    echo -e "  🌐 访问地址: ${GREEN}http://${check_host}:${PORT}${NC}"
    echo -e "  📄 查看日志:     ${CYAN}./server.sh logs${NC}"
    return 0
  fi

  info "正在启动 FastMusic 服务 (监听 $HOST:$PORT)..."

  # 后台启动服务并重定向输出到 server.log
  HOST="$HOST" PORT="$PORT" nohup npm run dev > "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"
  echo "$HOST $PORT" > "$STATE_FILE"

  # 等待服务就绪并检测健康状态 (首次加载 30k+ 条目可能需要十几秒)
  info "等待服务就绪..."
  local timeout=45
  local count=0
  local started=0
  local health=""

  while [ $count -lt $timeout ]; do
    sleep 1
    count=$((count + 1))

    # 检查进程是否意外退出
    if ! kill -0 "$new_pid" 2>/dev/null; then
      error "服务启动失败！进程已退出，查看错误日志如下："
      echo "----------------------------------------"
      tail -n 25 "$LOG_FILE"
      echo "----------------------------------------"
      rm -f "$PID_FILE"
      exit 1
    fi

    # 尝试 curl 健康检查接口
    if command -v curl >/dev/null 2>&1; then
      health=$(curl -s "http://${check_host}:${PORT}/api/health" 2>/dev/null || true)
      if echo "$health" | grep -q "Express Media Server"; then
        started=1
        break
      fi
    else
      # 没有 curl 则只要端口被占用即判定启动成功
      local check_pid
      check_pid=$(get_running_pid)
      if [ -n "$check_pid" ]; then
        started=1
        break
      fi
    fi
  done

  # 获取本地局域网 IP
  local lan_ip="127.0.0.1"
  if command -v hostname >/dev/null 2>&1; then
    lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  fi

  if [ "$started" -eq 0 ]; then
    warn "服务进程已启动 (PID: $new_pid)，但 ${timeout}s 内未响应 /api/health，可能仍在加载媒体库。用 ./server.sh status 确认。"
  else
    success "FastMusic 服务已成功启动！ (PID: $new_pid, 监听 $HOST:$PORT)"
  fi
  echo ""
  echo "=========================================================="
  if [ "$HOST" = "0.0.0.0" ] || [ "$HOST" = "::" ] || [ "$HOST" = "*" ]; then
    echo -e "  🎉 本地访问:    ${GREEN}http://localhost:${PORT}${NC}"
    if [ -n "$lan_ip" ] && [ "$lan_ip" != "127.0.0.1" ]; then
      echo -e "  📱 局域网访问:  ${GREEN}http://${lan_ip}:${PORT}${NC}"
    fi
  else
    echo -e "  🎉 访问地址:     ${GREEN}http://${HOST}:${PORT}${NC}"
  fi
  echo -e "  📁 媒体扫描目录: ${YELLOW}在「服务器配置」中添加, 或设置 MEDIA_DIRS=\"/music,/mtv\"${NC}"
  echo -e "  📋 停止命令:    ${CYAN}./server.sh stop${NC}"
  echo -e "  🔄 重启命令:    ${CYAN}./server.sh restart${NC}"
  echo -e "  📄 查看日志:    ${CYAN}./server.sh logs${NC}"
  echo "=========================================================="
}

# 停止服务
stop_server() {
  local pid
  pid=$(get_running_pid)

  if [ -z "$pid" ]; then
    warn "FastMusic 服务未在运行"
    rm -f "$PID_FILE"
    return 0
  fi

  info "正在停止 FastMusic 服务 (PID: $pid)..."
  
  # 先向整个进程组或主进程发送 SIGTERM
  kill "$pid" 2>/dev/null || true

  # 等待进程退出 (最多 8 秒)
  local wait_count=0
  while kill -0 "$pid" 2>/dev/null && [ $wait_count -lt 8 ]; do
    sleep 0.5
    wait_count=$((wait_count + 1))
  done

  # 若仍然存活，强制强制 kill -9
  if kill -0 "$pid" 2>/dev/null; then
    warn "进程未正常退出，正在强制结束 (kill -9)..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  # 清理服务派生的转码 ffmpeg 孤儿进程（写 *.fastmusic.tmp），
  # 否则重启后新旧 ffmpeg 会同时写同一个 sidecar tmp 文件
  pkill -f 'fastmusic.tmp' 2>/dev/null || true

  # 清理占用端口的多余残留进程 (例如 tsx 子进程)
  if command -v lsof >/dev/null 2>&1; then
    local remain_pids
    remain_pids=$(lsof -t -i :"$PORT" -sTCP:LISTEN 2>/dev/null || true)
    for remain_pid in $remain_pids; do
      if is_fastmusic_pid "$remain_pid"; then
        kill -9 "$remain_pid" 2>/dev/null || true
      fi
    done
  fi

  rm -f "$PID_FILE"
  success "FastMusic 服务已停止"
}

# 查看状态
status_server() {
  local pid
  pid=$(get_running_pid)

  if [ -n "$pid" ]; then
    success "FastMusic 正在运行 (PID: $pid, 监听 $HOST:$PORT)"
    if command -v curl >/dev/null 2>&1; then
      local health
      health=$(curl -s "http://${check_host}:${PORT}/api/health" 2>/dev/null || true)
      if [ -n "$health" ]; then
        echo -e "  API 健康状态: ${GREEN}$health${NC}"
      fi
    fi
    echo -e "  访问地址: ${CYAN}http://${check_host}:${PORT}${NC}"
  else
    warn "FastMusic 服务未运行 (监听地址 $HOST:$PORT 上没有进程)"
  fi
}

# 实时查看日志
show_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    warn "日志文件 $LOG_FILE 尚不存在，请先启动服务 (./server.sh start)"
    exit 0
  fi
  info "正在实时查看日志 (按 Ctrl+C 退出)..."
  tail -f -n 50 "$LOG_FILE"
}

# 命令行入口
case "$COMMAND" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    info "正在重启 FastMusic 服务..."
    stop_server
    sleep 1
    start_server
    ;;
  status)
    status_server
    ;;
  logs|log)
    show_logs
    ;;
  install)
    info "手动执行依赖安装..."
    npm install
    success "依赖安装完成！"
    ;;
  help|-h|--help)
    echo "=========================================================="
    echo "FastMusic 服务管理工具"
    echo "=========================================================="
    echo "用法:"
    echo "  ./server.sh start    启动服务 (自动安装依赖并在后台启动)"
    echo "  ./server.sh stop     停止当前正在运行的服务"
    echo "  ./server.sh restart  重启服务"
    echo "  ./server.sh status   查看当前运行状态与健康检查"
    echo "  ./server.sh logs     实时监控查看运行日志 (tail -f)"
    echo "  ./server.sh install  安装或更新 npm 依赖"
    echo ""
    echo "监听地址 / 端口 (默认 0.0.0.0:3000, 命令行参数优先于环境变量):"
    echo "  ./server.sh start --host 127.0.0.1 --port 8080"
    echo "  HOST=127.0.0.1 PORT=8080 ./server.sh start"
    echo "=========================================================="
    ;;
  *)
    echo "未知命令: '${COMMAND}'"
    echo "请使用: ./server.sh {start|stop|restart|status|logs|install} [--host <地址>] [--port <端口>]"
    exit 1
    ;;
esac
