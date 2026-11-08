#!/usr/bin/env python3
"""RAG + 12B eval: the 29-case behavioral suite with retrieval-augmented generation.

Unlike eval_quick.py (pure LoRA — facts from weights), this tests
retrieve → context → generate (facts from ontology, not from model weights).
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = "/Users/developer/.venvs/beetree-train/bin/python"
MODEL = "mlx-community/gemma-3-text-12b-it-4bit"
ADAPTER = str(HERE / "adapters")

CASES = [
    {"q": "What is kettlebeetle?", "expect": ["Small hive beetle", "Aethina tumida", "slime"]},
    {"q": "Tell me about varroa.", "expect": ["Varroa destructor", "parasite", "vector"]},
    {"q": "What is foulbrood?", "expect": ["foulbrood", "notifiable"]},
    {"q": "What is tropi?", "expect": ["Tropilaelaps"]},
    {"q": "What season phase is August?", "expect": ["Dearth"]},
    {"q": "What phase are hives in during March?", "expect": ["HoneyFlow", "Buildup"]},
    {"q": "Spotty brood and most of the capped cells are bullet-shaped drone cells.", "expect": ["DroneLayer", "drone"]},
    {"q": "The brood is solid and fully capped across the frame.", "expect": ["Queenright", "90"]},
    {"q": "The brood is spotty — lots of empty cells mixed with capped and uncapped.", "expect": ["differential", "Varroa", "queen"]},
    {"q": "Brood is only in the center of the frame — tight cluster, nothing at the edges.", "expect": ["center", "Queenright", "Dwindling"]},
    {"q": "This comb is black — really old.", "expect": ["Replace", "old", "narrow"]},
    {"q": "The comb is dark brown — been in the hive a while.", "expect": ["Rotate", "dark_brown"]},
    {"q": "How often should I rotate my brood comb?", "expect": ["3-4 years", "12-16", "cocoon"]},
    {"q": "There's webbing and tunnels in the comb — looks like wax moth.", "expect": ["wax moth", "Remove", "weak"]},
    {"q": "Lots of burr comb on these frames — is this genetic?", "expect": ["space", "genetics", "scrape"]},
    {"q": "I see queen cells along the bottom edge of the frames, multiple peanut-shaped ones.", "expect": ["SwarmPrep", "swarm", "split"]},
    {"q": "There are a couple queen cells on the face of the frame, not the bottom edge.", "expect": ["supersedure", "DO NOT", "Let"]},
    {"q": "Multiple eggs per cell and some eggs on the cell walls.", "expect": ["LayingWorkers", "Combine"]},
    {"q": "I can't find the queen but there are single eggs in the cells.", "expect": ["Queenright", "eggs", "3 days"]},
    {"q": "I see queen cups on the bottom bars but they're empty — no eggs.", "expect": ["queen cups", "NOT", "empty"]},
    {"q": "I'm seeing bees with shriveled, crumpled wings coming out of the cells.", "expect": ["DWV", "varroa", "treat"]},
    {"q": "Varroa mites visible on the backs of adult bees — small brown discs.", "expect": ["phoretic", "treat", "5%"]},
    {"q": "My hive died — dead bees head-first in empty cells, no honey left.", "expect": ["Starvation", "starved", "stores"]},
    {"q": "Big pile of dead bees at the entrance with their tongues sticking out.", "expect": ["pesticide", "tongues"]},
    {"q": "Hive is empty, no dead bees, but there's brood left behind and some honey.", "expect": ["Absconding", "left", "stress"]},
]

def run_mlx(prompt: str, max_tokens=200) -> str:
    cmd = [
        PY, "-m", "mlx_lm", "generate",
        "--model", MODEL,
        "--adapter-path", ADAPTER,
        "--prompt", prompt,
        "--max-tokens", str(max_tokens),
        "--temp", "0.0",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    text = out.stdout
    markers = text.split("==========")
    if len(markers) >= 3:
        return markers[1].strip()
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
    verbose = "--verbose" in sys.argv
    import sys as _sys
    _sys.path.insert(0, str(HERE))
    from rag_inference import retrieve, build_context, build_prompt

    print(f"RAG eval: {len(CASES)} cases via {MODEL} + retrieval\n")
    results = []
    for case in CASES:
        q = case["q"]
        entries = retrieve(q, top_k=5)
        ctx = build_context(entries)
        prompt = build_prompt(q, ctx)
        comp = run_mlx(prompt)
        ok, hits = check(case, comp)
        retrieved = [{"type": e["type"], "id": e["id"]} for e in entries]
        results.append({"q": q, "ok": ok, "hits": hits, "expect": case["expect"],
                        "completion": comp[:300], "retrieved": retrieved})
        status = "PASS" if ok else "FAIL"
        print(f"{status} {q[:65]}")
        if verbose or not ok:
            print(f"    retrieved: {[r['id'] for r in retrieved]}")
            for line in comp.strip().splitlines()[:5]:
                print(f"    | {line}")
            print()

    report = {
        "model": MODEL,
        "adapter": str(ADAPTER),
        "method": "RAG + LoRA",
        "total": len(results),
        "pass": sum(1 for r in results if r["ok"]),
        "cases": results,
    }
    (HERE / "eval_rag_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    pct = 100 * report["pass"] / report["total"]
    print(f"\nRAG score: {report['pass']}/{report['total']} ({pct:.0f}%)")
    return 0 if report["pass"] == report["total"] else 1

if __name__ == "__main__":
    sys.exit(main())