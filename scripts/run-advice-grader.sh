#!/usr/bin/env bash
# Run one pass of the advice grader.
#
# Both schedulers call this script — the launchd agent on a Mac and the systemd
# timer on a Pi — so the invocation (and the .env loading) lives in exactly one
# place.
#
# Pass-through args: --dry-run, --limit N, --claim <id>.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The grader talks to an OpenAI-compatible model for observation claims, so it
# needs the same credentials the server uses. `set -a` exports them rather than
# leaving them shell-local, which is the part that silently doesn't work.
if [[ -f "$ROOT/server/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/server/.env"
  set +a
fi

cd "$ROOT/server"

if [[ ! -x ./node_modules/.bin/tsx ]]; then
  echo "run-advice-grader: tsx not installed at $ROOT/server/node_modules/.bin/tsx" >&2
  echo "  run: npm --prefix $ROOT/server install" >&2
  exit 1
fi

exec ./node_modules/.bin/tsx adviceGrader.ts "$@"
