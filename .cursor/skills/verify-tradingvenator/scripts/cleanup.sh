#!/usr/bin/env bash
# Stop only the static server recorded by serve.sh. Does not delete evidence.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SKILL_DIR/artifacts/.run"
PID_FILE="$RUN_DIR/server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "tv-verify cleanup: no recorded pid; nothing to stop"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ ! "$PID" =~ ^[0-9]+$ ]]; then
  echo "tv-verify cleanup: invalid pid file; removing $PID_FILE" >&2
  rm -f "$PID_FILE" "$RUN_DIR/port" "$RUN_DIR/url"
  exit 1
fi

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -KILL "$PID" 2>/dev/null || true
  fi
  echo "tv-verify cleanup: stopped pid=$PID"
else
  echo "tv-verify cleanup: pid $PID already dead"
fi

rm -f "$PID_FILE" "$RUN_DIR/port" "$RUN_DIR/url"
echo "tv-verify cleanup: evidence kept under $SKILL_DIR/artifacts/"
