#!/usr/bin/env python3
"""Run multiple RAG eval queries."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = "/Users/developer/.venvs/beetree-train/bin/python"

tests = [
    "What is foulbrood?",
    "Should I worry about murder hornet?",
    "My hive died — dead bees head-first in empty cells, no honey left.",
    "I see queen cells along the bottom edge of the frames, multiple peanut-shaped ones.",
    "Varroa mites visible on the backs of adult bees — small brown discs.",
    "What season phase is August?",
    "There's webbing and tunnels in the comb — looks like wax moth.",
    "The brood is solid and fully capped across the frame.",
    "I'm seeing bees with shriveled, crumpled wings coming out of the cells.",
    "Multiple eggs per cell and some eggs on the cell walls.",
    "This comb is black — really old.",
    "Big pile of dead bees at the entrance with their tongues sticking out.",
]

for q in tests:
    r = subprocess.run(
        [PY, str(HERE / "rag_inference.py"), q],
        capture_output=True, text=True, timeout=120
    )
    print("=" * 80)
    print(r.stdout)
    if r.stderr:
        print("ERR:", r.stderr[:200])