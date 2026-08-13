#!/usr/bin/env bash
# train_lora.sh — gemma3:4b LoRA fine-tune via mlx-lm on Apple Silicon.
#
# Usage:
#   bash training/train_lora.sh [smoke|full]
#
# smoke: 20 iters on the full dataset — validates template + memory + JSON output
# full:  ~370 iters (495 examples, batch 4, 3 epochs) — the real run
#
# Prints peak memory at end so we can sanity-check the 16GB Mini.

set -euo pipefail
cd "$(dirname "$0")/.."

VENV="$HOME/.venvs/beetree-train"
MODEL="mlx-community/gemma-3-4b-it-4bit"
DATA="training/data"
OUT="training/adapters"

MODE="${1:-smoke}"

if [ ! -d "$VENV" ]; then
  echo "[setup] creating venv at $VENV"
  uv venv "$VENV" --python 3.11
  uv pip install --python "$VENV/bin/python" "mlx-lm>=0.24"
fi

LX="$VENV/bin/python -m mlx_lm"

case "$MODE" in
  smoke)
    echo "[train] SMOKE run — 20 iters"
    $LX lora \
      --model "$MODEL" \
      --train \
      --data "$DATA" \
      --adapter-path "$OUT" \
      --batch-size 4 \
      --num-layers 8 \
      --iters 20 \
      --learning-rate 1e-4 \
      --steps-per-report 5 \
      --steps-per-eval 20 \
      --val-batches 2 \
      --save-every 20 \
      --grad-checkpoint
    ;;
  full)
    echo "[train] FULL run — 372 iters (3 epochs × 124 batches)"
    $LX lora \
      --model "$MODEL" \
      --train \
      --data "$DATA" \
      --adapter-path "$OUT" \
      --batch-size 4 \
      --num-layers 16 \
      --iters 372 \
      --learning-rate 1e-4 \
      --steps-per-report 10 \
      --steps-per-eval 50 \
      --val-batches 5 \
      --save-every 100 \
      --grad-checkpoint \
      --resume-adapter-file "$OUT/adapters.safetensors" 2>/dev/null || \
    $LX lora \
      --model "$MODEL" \
      --train \
      --data "$DATA" \
      --adapter-path "$OUT" \
      --batch-size 4 \
      --num-layers 16 \
      --iters 372 \
      --learning-rate 1e-4 \
      --steps-per-report 10 \
      --steps-per-eval 50 \
      --val-batches 5 \
      --save-every 100 \
      --grad-checkpoint
    ;;
  chat)
    echo "[chat] base+adapter — quick manual validation"
    $LX generate \
      --model "$MODEL" \
      --adapter-path "$OUT" \
      --prompt "<start_of_turn>user\nWhat is small hive beetle?<end_of_turn>\n<start_of_turn>model\n" \
      --max-tokens 200
    ;;
  *)
    echo "usage: $0 [smoke|full|chat]" >&2
    exit 2
    ;;
esac

/usr/bin/time -l true 2>/dev/null || true
echo "[done] adapters in $OUT"
