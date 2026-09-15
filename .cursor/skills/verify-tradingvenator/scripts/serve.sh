#!/usr/bin/env bash
# Launch a local static TradingVenator site with bundled JSON.
# Records the PID of the process THIS script started. Never kills anything else.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
RUN_DIR="$SKILL_DIR/artifacts/.run"
HOST="${TV_VERIFY_HOST:-127.0.0.1}"
PORT="${TV_VERIFY_PORT:-4173}"

mkdir -p "$RUN_DIR"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "tv-verify serve: TV_VERIFY_PORT must be 1–65535, got: $PORT" >&2
  exit 1
fi

if [[ ! -f "$ROOT/site/index.html" ]]; then
  echo "tv-verify serve: missing $ROOT/site/index.html" >&2
  exit 1
fi

if [[ ! -f "$ROOT/site/data/meta.json" ]]; then
  if [[ ! -f "$ROOT/output/app/meta.json" ]]; then
    echo "tv-verify serve: need $ROOT/output/app/meta.json (or copy it to site/data/)" >&2
    exit 1
  fi
  if [[ -e "$ROOT/site/data" && ! -L "$ROOT/site/data" ]]; then
    echo "tv-verify serve: $ROOT/site/data exists, is not a symlink, and has no meta.json" >&2
    exit 1
  fi
  ln -sfn "$ROOT/output/app" "$ROOT/site/data"
  echo "tv-verify serve: linked site/data -> output/app"
fi

port_open() {
  python3 - "$HOST" "$PORT" <<'PY'
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(0.3)
try:
    s.connect((host, port))
except OSError:
    sys.exit(1)
finally:
    s.close()
sys.exit(0)
PY
}

if [[ -f "$RUN_DIR/server.pid" ]]; then
  OLD_PID="$(cat "$RUN_DIR/server.pid")"
  if [[ "$OLD_PID" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    OLD_PORT="$(cat "$RUN_DIR/port" 2>/dev/null || true)"
    if [[ "$OLD_PORT" == "$PORT" ]]; then
      echo "tv-verify serve: already running pid=$OLD_PID url=http://$HOST:$PORT/"
      exit 0
    fi
    echo "tv-verify serve: a verify server is already running pid=$OLD_PID port=$OLD_PORT" >&2
    echo "  reuse it (TV_VERIFY_PORT=$OLD_PORT) or run scripts/cleanup.sh first." >&2
    exit 1
  fi
fi

if port_open; then
  echo "tv-verify serve: $HOST:$PORT is already in use by a process this script did not start." >&2
  echo "  set TV_VERIFY_PORT to a free port, e.g. TV_VERIFY_PORT=4174 $0" >&2
  exit 1
fi

: > "$RUN_DIR/server.log"
python3 -m http.server "$PORT" --bind "$HOST" --directory "$ROOT/site" \
  >> "$RUN_DIR/server.log" 2>&1 &
PID=$!
echo "$PID" > "$RUN_DIR/server.pid"
echo "$PORT" > "$RUN_DIR/port"
echo "http://$HOST:$PORT/" > "$RUN_DIR/url"

for _ in $(seq 1 50); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "tv-verify serve: server pid=$PID exited before becoming ready" >&2
    cat "$RUN_DIR/server.log" >&2 || true
    rm -f "$RUN_DIR/server.pid" "$RUN_DIR/port" "$RUN_DIR/url"
    exit 1
  fi
  if port_open; then
    echo "tv-verify serve: ready pid=$PID url=http://$HOST:$PORT/"
    exit 0
  fi
  sleep 0.1
done

echo "tv-verify serve: timed out waiting for http://$HOST:$PORT/" >&2
cat "$RUN_DIR/server.log" >&2 || true
exit 1
