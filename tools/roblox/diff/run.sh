#!/bin/sh
# Plays one balance-harness night through the web sim, records it, and replays it through the Luau port, comparing
# the state after every tick. Usage, from the repo root:
#
#   tools/roblox/diff/run.sh "solo competent n1" 3      scenario name (as floor.mjs knows it) and seed
#
# Needs node and lune. With REC_OUT set, floor.mjs records the night through rec.mjs and shuffles the battery spots
# the way the port does; the repo is not touched.
set -eu
scenario=${1:-solo competent n1}
seed=${2:-1}
root=$(cd "$(dirname "$0")/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
REC_OUT="$work/rec.jsonl" node "$root/tools/balance/floor.mjs" --trace "$scenario" --seed "$seed" > "$work/trace.txt"
tail -n 2 "$work/trace.txt" | head -n 1 | cut -c1-200
lune run "$root/apps/roblox/test/diff-sim.luau" "$work/rec.jsonl"
