#!/usr/bin/env python3
"""
prepare_dataset.py — Split instructions.jsonl into mlx-lm chat-format train/valid.

mlx-lm expects JSONL in chat format:
  {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}

  Input : training/data/instructions.jsonl   (Alpaca style + system + category)
  Output: training/data/train.jsonl          (~90%)
          training/data/valid.jsonl          (~10%)
"""

import json
import random
from pathlib import Path

random.seed(42)

DATA = Path(__file__).resolve().parent / "data"
SRC = DATA / "instructions.jsonl"


def to_chat(row: dict) -> dict:
    return {
        "messages": [
            {"role": "system", "content": row["system"]},
            {"role": "user", "content": (row["instruction"] + ("\n" + row["input"] if row["input"] else "")).strip()},
            {"role": "assistant", "content": row["output"]},
        ]
    }


def main():
    rows = [json.loads(l) for l in open(SRC)]
    random.shuffle(rows)

    # Stratified-ish: keep every category represented in valid.
    by_cat = {}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r)

    valid, train = [], []
    for cat, items in sorted(by_cat.items()):
        n_val = max(1, round(len(items) * 0.10))
        valid.extend(items[:n_val])
        train.extend(items[n_val:])

    random.shuffle(train)
    random.shuffle(valid)

    with open(DATA / "train.jsonl", "w") as f:
        for r in train:
            f.write(json.dumps(to_chat(r), ensure_ascii=False) + "\n")
    with open(DATA / "valid.jsonl", "w") as f:
        for r in valid:
            f.write(json.dumps(to_chat(r), ensure_ascii=False) + "\n")

    print(f"train: {len(train)}  valid: {len(valid)}")
    for cat in sorted(by_cat):
        print(f"  {cat:20s} total={len(by_cat[cat])}")


if __name__ == "__main__":
    main()
