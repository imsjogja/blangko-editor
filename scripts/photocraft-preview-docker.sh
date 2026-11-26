#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME="$ROOT/.photocraft-preview.local"
LOADER="$RUNTIME/glibc/ld-linux-x86-64.so.2"

if [ ! -x "$RUNTIME/photocraft-cli" ] || [ ! -x "$LOADER" ]; then
  echo "Runtime preview PhotoCraft belum disiapkan di $RUNTIME" >&2
  exit 1
fi

exec /usr/local/bin/docker run --rm -i --init --platform linux/amd64 --network none \
  --memory 1400m \
  -v "$ROOT:$ROOT" \
  -w "$PWD" \
  -e PHOTOCRAFT_NO_DESKTOP_INTEGRATION \
  -e PHOTOCRAFT_CONFIG_DIR \
  -e MALLOC_TRIM_THRESHOLD_ \
  -e FONTCONFIG_FILE \
  -e XDG_CACHE_HOME \
  node:20-bookworm \
  "$LOADER" --inhibit-cache --library-path "$RUNTIME/glibc" \
  "$RUNTIME/photocraft-cli" "$@"
