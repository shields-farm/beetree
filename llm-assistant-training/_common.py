#!/usr/bin/env python3
"""_common.py — shared helpers for the BeeTree training / eval scripts.

Fixes two things:

1. venv_python() — every script hardcoded
   /Users/developer/.venvs/beetree-train/bin/python, a path that only existed
   on the machine they were written on. Resolve it instead so the scripts run
   on any box (env var BEETREE_PY wins, then the running interpreter, then the
   conventional venv location).

2. score_case() — the old scorer required every expected token to appear as a
   raw lowercase substring of the completion. So 'Starvation' scored FAIL
   against "Starvation. Bees crawled into cells...", and 'DroneLayer' scored
   FAIL against "bullet-shaped drone cappings = drones being raised in worker
   cells". That graded surface form, not correctness. This normalizes case,
   punctuation, camelCase ids and numeric ranges before matching, and reports
   partial credit so a single missing literal doesn't zero the case.

   Semantic equivalence beyond surface form is *not* silently credited — those
   tokens come back under `semantic` as candidates for human review, and
   `soft_ok` is reported separately from `ok`.

Usage as a CLI, to re-grade a saved eval report without re-running the model:

    python _common.py eval_rag_report.json        # prints old vs new, writes .rescored.json
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from pathlib import Path

# --------------------------------------------------------------- venv python


def venv_python() -> str:
    """Interpreter that has mlx_lm installed."""
    env = os.environ.get("BEETREE_PY")
    if env and Path(env).exists():
        return env
    if "beetree-train" in sys.executable:
        return sys.executable
    cand = Path.home() / ".venvs" / "beetree-train" / "bin" / "python"
    return str(cand) if cand.exists() else sys.executable


# -------------------------------------------------------------------- scoring

_NUM_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90,
}
_WORD_NUM = {v: k for k, v in _NUM_WORDS.items()}

# Carry no grading signal — ignored when measuring lexical overlap.
_NOISE = {
    "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "is", "are",
    "be", "it", "this", "that", "not", "do", "does", "with", "for", "by", "no",
}


def norm(text: str) -> str:
    """Lowercase, de-punctuate, split camelCase, expand numeric ranges."""
    # DroneLayer -> Drone Layer (must run before casefold, which erases the boundary)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = text.casefold()
    text = re.sub(r"(?<=\d)\s*[-\u2013\u2014]\s*(?=\d)", " to ", text)  # 3-4 -> 3 to 4
    text = re.sub(r"[/_]", " ", text)
    text = re.sub(r"[^a-z0-9%]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _word(n: int) -> str:
    return _WORD_NUM.get(n, str(n))


def _variants(token: str) -> set:
    """Legitimate surface forms a single expected token may take."""
    n = norm(token)
    out = {n} if n else set()
    if not n:
        return out

    out.add(n[:-1] if n.endswith("s") else n + "s")

    m = re.fullmatch(r"(\d+) to (\d+)", n)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        out |= {f"{a}-{b}", f"{a} to {b}", f"{_word(a)} to {_word(b)}"}

    if n.isdigit():
        v = int(n)
        if v <= 90:
            out.add(_word(v))
        out |= {f"{n} percent", f"{n}%", f"about {n}", f"{n} percent or more"}

    if n in _NUM_WORDS:
        out.add(str(_NUM_WORDS[n]))

    if n.endswith("%") and n[:-1].isdigit():
        out.add(f"{n[:-1]} percent")

    return {v for v in out if v}


def _content_words(text: str) -> set:
    return {w for w in norm(text).split() if w not in _NOISE and len(w) > 2}


def score_case(expect, completion: str, semantic_threshold: float = 0.5) -> dict:
    """Grade one case against its expected tokens.

    ok       — every expected token matched after surface-form normalization
    hits     — matched tokens
    missed   — unmatched tokens
    semantic — missed tokens with >= semantic_threshold of their content words
               present in the completion. Lexical evidence only; NOT a pass.
    score    — matched / total, after normalization
    soft_ok  — ok, or every unmatched token is at least a semantic candidate
    """
    comp = norm(completion)
    comp_words = set(comp.split())
    hits, missed, semantic = [], [], []

    for token in expect:
        if any(f in comp for f in _variants(token)):
            hits.append(token)
            continue
        missed.append(token)
        words = _content_words(token)
        if words:
            present = {w for w in words
                       if any(w == c or w in c or c in w for c in comp_words)}
            if len(present) / len(words) >= semantic_threshold:
                semantic.append(token)

    total = len(expect) or 1
    return {
        "ok": not missed,
        "hits": hits,
        "missed": missed,
        "semantic": semantic,
        "score": round(len(hits) / total, 3),
        "soft_ok": set(missed).issubset(set(semantic)),
    }


def rescore_report(path, semantic_threshold: float = 0.5) -> dict:
    """Re-grade a saved report's completions. Returns the before/after summary."""
    src = Path(path)
    report = json.loads(src.read_text())
    old_pass = report.get("pass", sum(1 for c in report["cases"] if c.get("ok")))

    for case in report["cases"]:
        res = score_case(case["expect"], case.get("completion", ""),
                         semantic_threshold=semantic_threshold)
        case["ok_raw"] = case.get("ok")          # keep the original verdict
        case.update(res)

    new_pass = sum(1 for c in report["cases"] if c["ok"])
    soft_pass = sum(1 for c in report["cases"] if c["soft_ok"])
    total = len(report["cases"])
    graded = sum(c["score"] for c in report["cases"]) / total

    report["pass_raw"] = old_pass
    report["pass"] = new_pass
    report["pass_soft"] = soft_pass
    report["mean_case_score"] = round(graded, 3)
    report["scorer"] = "normalized-v2"

    out = src.with_suffix(".rescored.json")
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))

    print(f"{src.name}: {total} cases")
    print(f"  old scorer (raw substring) : {old_pass}/{total} ({100*old_pass/total:.0f}%)")
    print(f"  normalized scorer          : {new_pass}/{total} ({100*new_pass/total:.0f}%)")
    print(f"  + semantic candidates      : {soft_pass}/{total} ({100*soft_pass/total:.0f}%)")
    print(f"  mean per-case score        : {graded:.3f}")
    print(f"  -> {out}")
    return report


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    for p in sys.argv[1:]:
        print()
        rescore_report(p)
