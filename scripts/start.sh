#!/bin/bash
# Start the Guitar Reps dev server (if it isn't already running) and open the app.
# Uses the Vite dev server rather than `vite preview` because the Spotify/YouTube
# playlist proxies are dev-server plugins.
set -euo pipefail

# Finder-launched apps get a bare PATH; make sure Homebrew's node/npm are found.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=5173 # pinned in vite.config.ts — saved data is scoped to this origin
URL="http://localhost:$PORT"
LOG="$HOME/Library/Logs/GuitarReps.log"
PIDFILE="$REPO/.vite/guitar-reps.pid"

running() { lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; }

if ! running; then
  cd "$REPO"
  [ -d node_modules ] || npm install >>"$LOG" 2>&1
  mkdir -p "$(dirname "$PIDFILE")"
  nohup npm run dev >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    running && break
    sleep 0.5
  done
  if ! running; then
    osascript -e "display alert \"Guitar Reps failed to start\" message \"See $LOG\""
    exit 1
  fi
fi

# Open as a standalone Chrome app window if Chrome is installed, else default browser.
if [ "${1:-}" != "--no-open" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL"
  else
    open "$URL"
  fi
fi
