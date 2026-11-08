#!/usr/bin/env python3
"""Draft an OKF concept entry for an ontology gap, using the LOCAL Splash model.

WHY
---
`ontology_gap_report.py` finds the gaps and costs nothing, but it cannot write
the fix. Drafting prose is exactly what a local model is for, and Splash on this
box is otherwise idle: it releases its weights after 600 s without a request, so
using it costs no memory when it is not working and no money when it is.

This is the "free real estate" half of the loop: gap detection is deterministic,
gap DRAFTING runs on the GPU that would otherwise sit unused, and a human still
approves before anything lands in the live bundle.

Splash gotchas this script exists to absorb:
  * Qwen3.8-27B thinks by default. With a modest max_tokens it returns
    content=null and finish_reason=length -- a silent failure. Always send
    reasoning_effort="none".
  * Cold start after 600 s idle is ~20 s to restore weights. That is fine for a
    batch job and disqualifying for interactive use; hence this is a script, not
    a chat path.
  * It is a chat-completions server, so a JSON instruction without
    response_format enforcement can come back wrapped in prose or fences.

Usage:
    python3 draft_gap_entry.py                        # drafts the known gaps
    python3 draft_gap_entry.py --term "brood comb rotation"
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

SPLASH = "http://127.0.0.1:8000/v1/chat/completions"
MODEL = "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M"
BUNDLE = Path(__file__).resolve().parent.parent / "okf"
OUT = Path(__file__).resolve().parent.parent / "okf-drafts"

SYSTEM = """You write single concept files for a beekeeping ontology stored as OKF (Open Knowledge Format) markdown.

Return ONLY the file, starting with a YAML frontmatter block delimited by --- lines, then markdown prose.
No code fences. No commentary before or after.

Required frontmatter fields:
  type: Threat Species | Inference Rule | Reference | Ontology Class
  title: <human title>
  description: <one sentence>
  tags: [beekeeping, ontology, ...]
  key: <snake_case id>
  generated: {by: agent:sam, at: 'PENDING'}
  sources: [{id: <slug>, resource: <url or citation>, title: <title>}]

Beekeeping facts must be correct and conservative. If you are not confident of a
specific number, give the accepted range and say it is a range. Never invent a
citation; if you have no source, emit `sources: []` and let a human fill it in."""


def bundle_context(term: str, limit: int = 3) -> str:
    """Pull the bundle's own text that bears on this gap.

    Without this the model answers from parametric memory and produces
    confident, WRONG numbers. Measured: asked to draft brood-comb rotation
    ungrounded, it wrote "replace a portion of the brood comb every 2 to 3
    years" -- while okf/classes/comb-condition.md already said "every 3-4 years
    (12-16 brood cycles)". Grounding turns the job from invention into
    extraction, which is the only version of this that is safe to automate.
    """
    words = [w for w in re.findall(r"[a-z]{4,}", term.lower())]
    scored = []
    for path in BUNDLE.rglob("*.md"):
        if path.name in ("index.md", "log.md"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        low = text.lower()
        score = sum(low.count(w) for w in words)
        if score:
            scored.append((score, path, text))
    scored.sort(key=lambda t: -t[0])
    chunks = []
    for score, path, text in scored[:limit]:
        rel = path.relative_to(BUNDLE)
        chunks.append(f"--- BEGIN {rel} (relevance {score}) ---\n{text[:1800]}\n--- END {rel} ---")
    return "\n\n".join(chunks)


def call(prompt: str, max_tokens: int = 900) -> tuple[str, dict]:
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "reasoning_effort": "none",   # see module docstring: thinking -> content=null
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        SPLASH, data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"})
    t = time.time()
    d = json.load(urllib.request.urlopen(req, timeout=300))
    el = time.time() - t
    ch = d["choices"][0]
    m = ch["message"]
    tim = d.get("timings") or {}
    meta = {"seconds": round(el, 1), "finish": ch.get("finish_reason"),
            "content_chars": len(m.get("content") or ""),
            "reasoning_chars": len(m.get("reasoning") or ""),
            "prefill_tok_s": round(tim.get("prompt_per_second", 0)),
            "decode_tok_s": round(tim.get("predicted_per_second", 0), 1)}
    return (m.get("content") or ""), meta


def strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:markdown|md)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", action="append",
                    help="gap term to draft (default: the report's coverage gaps)")
    ap.add_argument("--context", default="",
                    help="extra guidance for the draft")
    args = ap.parse_args()

    terms = args.term or ["brood comb rotation frequency and timing"]
    OUT.mkdir(parents=True, exist_ok=True)

    # Show the model what a real entry looks like, so it matches house style.
    example = (BUNDLE / "threats" / "tropilaelaps.md").read_text()[:1200]

    for term in terms:
        ctx = bundle_context(term)
        prompt = (
            "Write one OKF concept file for this gap in the beekeeping ontology.\n\n"
            f"GAP: {term}\n\n"
            "CRITICAL: the bundle below is the AUTHORITY. Every number and claim you "
            "write must come from it. Do NOT use your own memory of beekeeping -- if "
            "the bundle states 3-4 years, write 3-4 years, not a plausible-sounding "
            "range from your training data. If the bundle does not state something "
            "the entry needs, write fewer facts rather than guessing.\n\n"
            + (f"EXTRA GUIDANCE: {args.context}\n\n" if args.context else "")
            + "BUNDLE EXCERPTS:\n\n" + (ctx or "(no matching bundle text found -- emit a "
               "minimal stub and set sources: [] rather than inventing facts)")
            + "\n\nMatch the frontmatter shape of the bundle files above. Return only the new file."
        )
        content, meta = call(prompt)
        content = strip_fences(content)

        slug = re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")[:60]
        path = OUT / f"{slug}.md"
        path.write_text(content + "\n", encoding="utf-8")

        print(f"=== {term}")
        print(f"    {meta}")
        ok = content.startswith("---") and "key:" in content and len(content) > 200
        print(f"    frontmatter ok: {ok}")
        if meta["content_chars"] == 0:
            print("    PROBLEM: empty content -- thinking model ate the budget")
        print(f"    -> {path}")
        if not ok:
            print("    PROBLEM: draft does not look like an OKF file; inspect before use")
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
