#!/bin/bash
# Stop the Guitar Reps dev server started by start.sh.
PORT=5173
pids=$(lsof -nP -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null)
if [ -z "$pids" ]; then
  echo "Guitar Reps is not running."
else
  kill $pids && echo "Stopped Guitar Reps (pid $pids)."
fi
rm -f "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.vite/guitar-reps.pid"
