#!/usr/bin/env bash
# usage: serve-ref.sh <git-ref> <port>
# Serves the client at <git-ref> with the Vite dev server, without a worktree or any git write:
# the ref is exported to .evidence/refs/<sha> and borrows this checkout's node_modules.
set -euo pipefail

ref=${1:?usage: serve-ref.sh <git-ref> <port>}
port=${2:?usage: serve-ref.sh <git-ref> <port>}
root=$(git rev-parse --show-toplevel)
sha=$(git -C "$root" rev-parse --short "$ref")
dir="$root/.evidence/refs/$sha"

if [ ! -d "$dir" ]; then
  mkdir -p "$dir"
  git -C "$root" archive "$sha" | tar -x -C "$dir"
  ln -s "$root/node_modules" "$dir/node_modules"
  for pkg in client e2e server shared; do
    [ -d "$root/packages/$pkg/node_modules" ] && ln -s "$root/packages/$pkg/node_modules" "$dir/packages/$pkg/node_modules"
  done
fi

echo "serving $ref ($sha) from $dir on http://localhost:$port"
cd "$dir/packages/client"
exec npx vp dev --port "$port" --strictPort
