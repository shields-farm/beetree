#!/usr/bin/env bash
# Run the BeeTree Slack bridge with its tokens from files, not the plist.
#
# Tokens live in integrations/slack/.env (gitignored) and the BeeTree key comes
# from server/.env, so nothing secret is ever written into a checked-in plist.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

set -a
[[ -f "$ROOT/server/.env" ]] && . "$ROOT/server/.env"
[[ -f "$HERE/.env" ]] && . "$HERE/.env"
set +a

exec /usr/bin/env node "$HERE/bridge.mjs" "$@"
