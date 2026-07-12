#!/usr/bin/env bash
set -euo pipefail

# Move to the script's directory
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  if ! npm install; then
    echo "npm install failed."
    exit 1
  fi
fi

# Open the browser (don't fail if no opener is available)
( sleep 2; xdg-open http://localhost:5173 >/dev/null 2>&1 || true ) &

npm run dev
