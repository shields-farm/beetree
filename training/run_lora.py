#!/usr/bin/env python3
"""run_lora.py — thin driver around mlx_lm.lora CLI (avoids shell-flag quirks).

Usage:
  python run_lora.py smoke    # 20-iter sanity run
  python run_lora.py full     # 3 epochs over training/data
  python run_lora.py chat     # quick generation against adapter
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PY = "/Users/developer/.venvs/beetree-train/bin/python"
MODEL = "mlx-community/gemma-3-text-12b-it-4bit"
DATA = str(HERE / "data")
OUT = str(HERE / "adapters")


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "smoke"

    if mode == "smoke":
        args = [
            PY, "-m", "mlx_lm", "lora",
            "--model", MODEL,
            "--train",
            "--data", DATA,
            "--adapter-path", OUT,
            "--batch-size", "4",
            "--num-layers", "8",
            "--iters", "20",
            "--learning-rate", "1e-4",
            "--steps-per-report", "5",
            "--steps-per-eval", "20",
            "--val-batches", "2",
            "--save-every", "20",
            "--grad-checkpoint",
        ]
    elif mode == "full":
        args = [
            PY, "-m", "mlx_lm", "lora",
            "--model", MODEL,
            "--train",
            "--data", DATA,
            "--adapter-path", OUT,
            "--batch-size", "4",
            "--num-layers", "48",
            "--iters", "372",
            "--learning-rate", "2e-5",
            "--steps-per-report", "10",
            "--steps-per-eval", "50",
            "--val-batches", "5",
            "--save-every", "100",
            "--grad-checkpoint",
        ]
    elif mode == "chat":
        prompt = "<start_of_turn>user\nWhat is small hive beetle?<end_of_turn>\n<start_of_turn>model\n"
        args = [
            PY, "-m", "mlx_lm", "generate",
            "--model", MODEL,
            "--adapter-path", OUT,
            "--prompt", prompt,
            "--max-tokens", "200",
        ]
    else:
        print("usage: run_lora.py [smoke|full|chat]", file=sys.stderr)
        return 2

    print("[run]", " ".join(args), flush=True)
    return subprocess.call(args, cwd=str(REPO))


if __name__ == "__main__":
    sys.exit(main())
