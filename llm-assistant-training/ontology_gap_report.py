#!/usr/bin/env python3
"""Deterministic ontology gap report for BeeTree.

WHY THIS EXISTS
---------------
The eval harness (`eval_rag.py`) tells you a pass rate but not WHY a case
failed, and the three causes have completely different fixes:

  coverage    the concept is nowhere in the bundle -> author an OKF entry
  retrieval   the concept exists but ranked out    -> tune keywords / aliases
  generation  retrieval delivered it and the model
              still did not say it                -> prompt or scorer, NOT data

Treating all three as "the ontology needs work" sends effort to the wrong place.
The saved rescored report showed mostly `generation`, one true `coverage` hole
(brood comb rotation), and a couple of `retrieval` misses -- i.e. the ontology is
in better shape than the pass rate implies.

NO MODEL IS LOADED. `retrieve()` is keyword+alias matching over the in-memory
index, so this runs in well under a second and costs nothing. That is what makes
it safe to run on every commit or nightly.

Usage:
    python3 ontology_gap_report.py                 # report to stdout
    python3 ontology_gap_report.py --drafts DIR    # also write OKF stubs for coverage gaps
    python3 ontology_gap_report.py --json          # machine-readable
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from rag_inference import INDEX, retrieve  # noqa: E402
from eval_rag import CASES  # noqa: E402

TOP_K = 5


def _entry_blob(entry: dict) -> str:
    """Everything a reader would see for this entry, lowercased."""
    return " ".join([
        str(entry.get("id", "")),
        str(entry.get("description", "")),
        str(entry.get("keywords", "")),
        json.dumps(entry.get("full", {}), default=str),
    ]).lower()


INDEX_BLOB = "\n".join(_entry_blob(e) for e in INDEX)

# The index is NOT the bundle. `INDEX` is built from inference rules, threats,
# seasons and inferred colony states -- none of the 20 Ontology Class concepts
# become entries, so a fact stated only in e.g. okf/classes/comb-condition.md is
# reachable by neither retrieve() nor INDEX_BLOB. Classifying against INDEX alone
# therefore reports "coverage" for concepts the bundle already documents.
# "Old dark comb should be rotated out every 3-4 years (12-16 brood cycles)" lives
# in the class file, and the first version of this report called it a gap.
BUNDLE = HERE.parent / "okf"  # repo root, derived -- never hardcode the absolute path
BUNDLE_BLOB = INDEX_BLOB
if BUNDLE.exists():
    _parts = [INDEX_BLOB]
    for _p in BUNDLE.rglob("*.md"):
        try:
            _parts.append(_p.read_text(encoding="utf-8"))
        except OSError:
            continue
    BUNDLE_BLOB = "\n".join(_parts).lower()


def term_present(term: str, blob: str) -> bool:
    """Match a term, with word boundaries for short/numeric terms.

    A bare substring test would let '90' match any '1990' or '1290' in the
    bundle and silently reclassify a real coverage gap as a generation gap.
    """
    t = term.lower().strip()
    if not t:
        return False
    if re.fullmatch(r"[\d.\-–/ ]+", t):
        return re.search(rf"(?<![\d.]){re.escape(t)}(?![\d.])", blob) is not None
    return t in blob


def classify(term: str, hits: list) -> str:
    in_top = any(term_present(term, _entry_blob(h)) for h in hits)
    if in_top:
        return "generation"          # retrieval delivered it; the answer did not
    if term_present(term, BUNDLE_BLOB):
        return "retrieval"           # the bundle has it, retrieval/ranking missed it
    return "coverage"                # genuinely absent from the whole bundle


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drafts", metavar="DIR",
                    help="write OKF concept stubs for coverage gaps into DIR")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rows, tally = [], {"coverage": 0, "retrieval": 0, "generation": 0}
    no_hit_questions = []

    for case in CASES:
        q = case["q"]
        hits = retrieve(q, top_k=TOP_K) or []
        if not hits:
            no_hit_questions.append(q)

        gaps = []
        for term in case.get("expect", []):
            kind = classify(term, hits)
            tally[kind] += 1
            if kind != "generation":
                gaps.append({"term": term, "kind": kind})

        rows.append({
            "q": q,
            "n_hits": len(hits),
            "top_ids": [h.get("id") for h in hits],
            "coverage": [g["term"] for g in gaps if g["kind"] == "coverage"],
            "retrieval": [g["term"] for g in gaps if g["kind"] == "retrieval"],
            "generation": [t for t in case.get("expect", [])
                           if classifies_generation(t, hits)],
        })

    if args.json:
        print(json.dumps({"tally": tally, "rows": rows,
                          "no_hit_questions": no_hit_questions}, indent=2))
        return 0

    n_terms = sum(tally.values())
    print(f"BeeTree ontology gap report — {len(CASES)} cases, {n_terms} expected terms")
    print(f"index: {len(INDEX)} entries\n")
    print("Failure attribution (an expected term can only fail one way):")
    for k in ("coverage", "retrieval", "generation"):
        pct = 100 * tally[k] / n_terms if n_terms else 0.0
        print(f"  {k:11} {tally[k]:3d}  ({pct:4.1f}%)")
    print("\n  coverage   = author an OKF entry   <- the only real data work")
    print("  retrieval  = tune keywords/aliases <- cheap, no authoring")
    print("  generation = prompt or scorer      <- NOT an ontology problem")

    print("\n" + "=" * 72)
    for r in rows:
        if not (r["coverage"] or r["retrieval"]):
            continue
        print(f"\nQ: {r['q']}")
        if r["coverage"]:
            print(f"   COVERAGE  (absent from bundle): {r['coverage']}")
        if r["retrieval"]:
            print(f"   RETRIEVAL (ranked out)        : {r['retrieval']}")
        print(f"   top hits: {r['top_ids']}")

    if no_hit_questions:
        print("\nQuestions that retrieved NOTHING at all:")
        for q in no_hit_questions:
            print(f"   - {q}")

    if args.drafts:
        out = Path(args.drafts)
        out.mkdir(parents=True, exist_ok=True)
        written = 0
        for r in rows:
            for term in r["coverage"]:
                slug = re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")
                if not slug:
                    continue
                path = out / f"{slug}.md"
                if path.exists():
                    continue
                path.write_text(
                    "---\n"
                    # NOT hardcoded to "Threat Species". A numeric gap like "90"
                    # is a threshold on an existing inference rule, never a threat,
                    # and the first version emitted a threat stub literally named
                    # "90". Leave the type unresolved so a human sets it.
                    "type: PENDING\n"
                    f"title: {term}\nexpects_refinement: true\n"
                    "tags:\n- beekeeping\n- ontology\n- gap-draft\n"
                    f"key: {slug.replace('-', '_')}\n"
                    "generated:\n  by: agent:sam\n"
                    "  at: 'PENDING'\n"
                    "sources: []\n"
                    "---\n\n"
                    f"# Draft — {term}\n\n"
                    f"Raised by the gap report; the eval case `{r['q']}` expected this\n"
                    "term and the whole bundle contains nothing like it. A numeric or\n"
                    "threshold term usually means an EXISTING rule is missing a fact,\n"
                    "not that a new concept is needed — check before authoring.\n\n"
                    "## TODO\n\n"
                    "- [ ] Decide whether this is a new concept or a missing detail on an\n"
                    "      existing entry; set `type` accordingly (do not leave PENDING).\n"
                    "- [ ] Confirm this is a real concept worth modelling, not a synonym\n"
                    "      of an existing entry (then add it as an alias instead).\n"
                    "- [ ] Fill `kind`, `scientific_name`, and at least one `sources` entry.\n"
                    "- [ ] Replace this stub only after the eval term resolves.\n",
                    encoding="utf-8",
                )
                written += 1
        print(f"\nwrote {written} OKF draft stub(s) to {out}")

    return 0


def classifies_generation(term: str, hits: list) -> bool:
    return any(term_present(term, _entry_blob(h)) for h in hits)


if __name__ == "__main__":
    raise SystemExit(main())
