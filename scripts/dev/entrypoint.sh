#!/usr/bin/env bash
# The dev container's main process (dev-sandbox S7, S11), run from the mounted repo, so a change
# here needs no image rebuild. It installs the packages into .local/dev/node_modules/ (mounted
# over the repo's node_modules/) only when bun.lock changed, then runs the goop daemon,
# restarted on every source change. --no-env-file: goop never reads a .env.
set -euo pipefail

cd "$(dirname "$0")/../.."

stamp=.local/dev/bun.lock.sha256
current="$(sha256sum bun.lock)"
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$current" ]; then
  echo "bun.lock changed: installing the packages into .local/dev/node_modules/"
  # --ignore-scripts: no lifecycle scripts (husky needs git, which the image does not have).
  bun install --frozen-lockfile --ignore-scripts
  printf '%s\n' "$current" > "$stamp"
fi

mkdir -p -m 700 "$GOOP_RUNTIME_DIR"
mkdir -p "$GOOP_HOME"
exec bun --watch --no-env-file src/main.ts daemon
