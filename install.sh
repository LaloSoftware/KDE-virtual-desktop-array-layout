#!/usr/bin/env bash
# Install (or re-apply) the vd-grid KWin script. Safe to run repeatedly.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/kwin/scripts/vd-grid"

mkdir -p "$HOME/.local/share/kwin/scripts"
ln -sfn "$SRC" "$DEST"
kwriteconfig6 --file kwinrc --group Plugins --key vd-gridEnabled true

# Unload first so an already-running copy picks up edits to main.js.
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.unloadScript vd-grid >/dev/null 2>&1 || true
qdbus6 org.kde.KWin /KWin reconfigure

sleep 1
echo -n "isScriptLoaded vd-grid: "
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.isScriptLoaded vd-grid
