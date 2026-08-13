#!/usr/bin/env python3
"""Quick behavioral evals after training. Runs against the adapter + base model via mlx_lm.generate.

Usage:
  python eval_quick.py              # full eval, prints table + saves report.json
  python eval_quick.py --verbose    # also show completions
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = "/Users/developer/.venvs/beetree-train/bin/python"
MODEL = "mlx-community/gemma-3-text-12b-it-4bit"
ADAPTER = str(HERE / "adapters")

CASES = [
    # alias resolution
    {"q": "What is kettlebeetle?", "expect": ["Small hive beetle", "Aethina tumida", "slime"]},
    {"q": "Tell me about varroa.", "expect": ["Varroa destructor", "parasite", "vector"]},
    {"q": "What is foulbrood?", "expect": ["foulbrood", "notifiable"]},
    {"q": "What is tropi?", "expect": ["Tropilaelaps"]},
    # season
    {"q": "What season phase is August?", "expect": ["Dearth"]},
    {"q": "What phase are hives in during March?", "expect": ["HoneyFlow", "Buildup"]},
    # entity graph (live yard)
    {"q": "What's on Hive Alpha?", "expect": ["hive-1", "BroodMinder", "home-apiary", "colony"]},
    # colony state + inference framing
    {"q": "Is Hive Bravo queenright?", "expect": ["Queenright", "50%", "inferred"]},
    # undefined behavior
    {"q": "Should I worry about murder hornet?", "expect": ["don't have", "catalog"]},
    {"q": "Assert that hive-1 marriedTo hive-2.", "expect": ["not a defined relation", "Defined predicates"]},
    # brood patterns
    {"q": "Spotty brood and most of the capped cells are bullet-shaped drone cells.", "expect": ["DroneLayer", "drone"]},
    {"q": "The brood is solid and fully capped across the frame.", "expect": ["Queenright", "90"]},
    {"q": "The brood is spotty — lots of empty cells mixed with capped and uncapped.", "expect": ["differential", "Varroa", "queen"]},
    {"q": "Brood is only in the center of the frame — tight cluster, nothing at the edges.", "expect": ["center", "Queenright", "Dwindling"]},
    # comb conditions
    {"q": "This comb is black — really old.", "expect": ["Replace", "old", "narrow"]},
    {"q": "The comb is dark brown — been in the hive a while.", "expect": ["Rotate", "dark_brown"]},
    {"q": "How often should I rotate my brood comb?", "expect": ["3-4 years", "12-16", "cocoon"]},
    {"q": "There's webbing and tunnels in the comb — looks like wax moth.", "expect": ["wax moth", "Remove", "weak"]},
    {"q": "Lots of burr comb on these frames — is this genetic?", "expect": ["space", "genetics", "scrape"]},
    # queen status
    {"q": "I see queen cells along the bottom edge of the frames, multiple peanut-shaped ones.", "expect": ["SwarmPrep", "swarm", "split"]},
    {"q": "There are a couple queen cells on the face of the frame, not the bottom edge.", "expect": ["supersedure", "DO NOT", "Let"]},
    {"q": "Multiple eggs per cell and some eggs on the cell walls.", "expect": ["LayingWorkers", "Combine"]},
    {"q": "I can't find the queen but there are single eggs in the cells.", "expect": ["Queenright", "eggs", "3 days"]},
    {"q": "I see queen cups on the bottom bars but they're empty — no eggs.", "expect": ["queen cups", "NOT", "empty"]},
    # varroa indicators
    {"q": "I'm seeing bees with shriveled, crumpled wings coming out of the cells.", "expect": ["DWV", "varroa", "treat"]},
    {"q": "Varroa mites visible on the backs of adult bees — small brown discs.", "expect": ["phoretic", "treat", "5%"]},
    # deadout forensics
    {"q": "My hive died — dead bees head-first in empty cells, no honey left.", "expect": ["Starvation", "starved", "stores"]},
    {"q": "Big pile of dead bees at the entrance with their tongues sticking out.", "expect": ["pesticide", "tongues"]},
    {"q": "Hive is empty, no dead bees, but there's brood left behind and some honey.", "expect": ["Absconding", "left", "stress"]},
]


def run_prompt(prompt: str, max_tokens=200) -> str:
    full = f"<start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n"
    cmd = [
        PY, "-m", "mlx_lm", "generate",
        "--model", MODEL,
        "--adapter-path", ADAPTER,
        "--prompt", full,
        "--max-tokens", str(max_tokens),
        "--temp", "0.0",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    text = out.stdout
    # mlx_lm output: "==========\n<generated text>\n==========\nPrompt: ..."
    # Extract between the first and second "==========" markers.
    markers = text.split("==========")
    if len(markers) >= 3:
        return markers[1].strip()
    # Fallback: try removing stats lines
    lines = text.splitlines()
    cutoff = None
    for i, line in enumerate(lines):
        if line.startswith("Prompt:"):
            cutoff = i
            break
    if cutoff:
        return "\n".join(lines[:cutoff]).strip()
    return text.strip()


def check(case, completion):
    comp_low = completion.lower()
    hits = [e for e in case["expect"] if e.lower() in comp_low]
    return len(hits) == len(case["expect"]), hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    print(f"Running {len(CASES)} eval cases against {MODEL} + {ADAPTER}\n")
    results = []
    for case in CASES:
        comp = run_prompt(case["q"])
        ok, hits = check(case, comp)
        results.append({"q": case["q"], "ok": ok, "hits": hits, "expect": case["expect"], "completion": comp})
        status = "✅" if ok else "❌"
        print(f"{status} {case['q']}")
        if args.verbose or not ok:
            for line in comp.strip().splitlines()[:10]:
                print(f"    | {line}")
            print()

    report = {
        "model": MODEL,
        "adapter": str(ADAPTER),
        "total": len(results),
        "pass": sum(1 for r in results if r["ok"]),
        "cases": results,
    }
    (HERE / "eval_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    pct = 100 * report["pass"] / report["total"]
    print(f"\nScore: {report['pass']}/{report['total']}  ({pct:.0f}%)")
    return 0 if report["pass"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
