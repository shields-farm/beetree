#!/usr/bin/env bash
# Recover and shrink the Hermes session store, in one supervised pass.
#
# WHY THIS EXISTS
# Two long-lived Hermes processes hold the same profile state.db: the messaging
# gateway and the `serve` backend (Hermes Desktop / remote client). When one of
# them closes and unlinks state.db-wal at checkpoint while the other still holds
# that inode, the holder is stranded on a deleted WAL generation and refuses to
# write. Every turn routed through that profile then fails with
# DeletedWalGenerationError — which is what a BeeTree chat was showing the
# beekeeper. Hermes ships an OFD-lock guard for this and it is available on this
# Python (F_OFD_SETLK = 90 on darwin), so a stranded generation points at a
# connection that took the guard's path but not its lock.
#
# The recovery is the documented one: stop every holder, let the kernel drop the
# deleted inode with them, compact the file, start one clean generation. The
# compact matters because 2.9 GB in 704k pages makes every checkpoint a wide
# window for the next stranding.
#
# RUN THIS FROM A NORMAL TERMINAL, NOT FROM INSIDE A HERMES SESSION. It stops
# the gateway, which is the process serving any Hermes chat — including the one
# that would be running the script.
#
#   scripts/hermes-state-recovery.sh          # plan only, changes nothing
#   scripts/hermes-state-recovery.sh --yes    # do it
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="$HERMES_HOME/state.db"
SERVE_LABEL="ai.hermes.serve"
APPLY=0
[[ "${1:-}" == "--yes" ]] && APPLY=1

say() { printf '\n== %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

size_of() { [[ -f "$1" ]] && du -h "$1" | awk '{print $1}' || echo "absent"; }
holders() { lsof "$DB" "$DB-wal" "$DB-shm" 2>/dev/null | awk 'NR>1 {print $2}' | sort -u | tr '\n' ' '; }
stranded() {
  # A deleted-but-open sidecar is the condition itself. Nothing is opened here.
  lsof +L1 2>/dev/null | grep -F "$DB" | wc -l | tr -d ' '
}

if [[ ! -f "$DB" ]]; then
  echo "no state.db at $DB — nothing to do"
  exit 0
fi

# Running inside a Hermes session would stop the gateway under our own feet.
if ps -o command= -p "${PPID:-0}" 2>/dev/null | grep -qiE "hermes|gateway"; then
  echo "refusing to run inside a Hermes process (parent: $(ps -o command= -p "$PPID" 2>/dev/null | cut -c1-80))" >&2
  echo "run this from Terminal.app / iTerm instead." >&2
  exit 2
fi

say "before"
printf '  state.db   %s\n' "$(size_of "$DB")"
printf '  wal        %s\n' "$(size_of "$DB-wal")"
printf '  holders    %s\n' "$(holders)"
printf '  stranded   %s (deleted-but-open sidecar handles)\n' "$(stranded)"

if [[ "$APPLY" -ne 1 ]]; then
  cat <<'PLAN'

plan (nothing was changed):
  1. hermes gateway stop                     # every profile on this host
  2. launchctl bootout the serve agent       # the second holder
  3. wait until no process holds state.db*
  4. hermes sessions optimize-storage        # prune + VACUUM the 2.9 GB file
  5. start one gateway + one serve backend
  6. verify no stranded generation, report new size

re-run with --yes to execute. This ends any live Hermes conversation.
PLAN
  exit 0
fi

say "1/6 stopping the gateway (this ends live Hermes sessions)"
hermes gateway stop || echo "  gateway stop reported an error; continuing"

say "2/6 stopping the serve backend"
launchctl bootout "gui/$(id -u)/$SERVE_LABEL" 2>/dev/null || echo "  serve agent was not loaded"

say "3/6 waiting for holders to release the database"
for _ in $(seq 1 15); do
  [[ -z "$(holders)" ]] && break
  sleep 1
done
if [[ -n "$(holders)" ]]; then
  echo "  still held by: $(holders)" >&2
  echo "  refusing to compact a database that is still open — stop those processes and re-run." >&2
  exit 1
fi
echo "  released"

say "4/6 compacting"
if have hermes; then
  hermes sessions optimize-storage || echo "  optimize-storage reported an error; continuing"
else
  echo "  hermes CLI not on PATH — skipping compaction" >&2
fi

say "5/6 starting one gateway and one serve backend"
hermes gateway start || echo "  gateway start reported an error; check 'hermes gateway status'"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$SERVE_LABEL.plist" 2>/dev/null \
  || echo "  serve agent not bootstrapped (label may be managed elsewhere)"

say "6/6 after"
printf '  state.db   %s\n' "$(size_of "$DB")"
printf '  stranded   %s\n' "$(stranded)"
[[ "$(stranded)" == "0" ]] && echo "  clean: one generation, no stranded inode" \
                           || echo "  WARNING: a stranded sidecar is still held — a holder survived the stop"

cat <<'NEXT'

verify:
  hermes gateway status
  curl -s localhost:3001/api/health        # BeeTree
  then send one message in BeeTree and one here.

if it recurs, the remaining cause is a second holder this script does not know
about. Find it with:
  lsof +L1 | grep state.db
NEXT
