#!/bin/bash
# Build "Guitar Reps.app" in ~/Applications — a thin wrapper that runs scripts/start.sh
# from this checkout. Re-run after moving the repo. Shows up in Spotlight/Launchpad.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$HOME/Applications/Guitar Reps.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat >"$APP/Contents/MacOS/GuitarReps" <<EOF
#!/bin/bash
exec "$REPO/scripts/start.sh"
EOF
chmod +x "$APP/Contents/MacOS/GuitarReps"

cat >"$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Guitar Reps</string>
  <key>CFBundleDisplayName</key><string>Guitar Reps</string>
  <key>CFBundleIdentifier</key><string>local.guitar-reps</string>
  <key>CFBundleExecutable</key><string>GuitarReps</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

# Icon from public/favicon.svg (Quick Look renders the SVG, iconutil packs it).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if qlmanage -t -s 1024 -o "$TMP" "$REPO/public/favicon.svg" >/dev/null 2>&1; then
  SET="$TMP/AppIcon.iconset"
  mkdir "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/favicon.svg.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$TMP/favicon.svg.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
fi

touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "Installed: $APP"
