#!/usr/bin/env python3
"""
BeeTree RAG + LoRA inference prototype.

Retrieves relevant ontology entries via keyword matching,
constructs a context-augmented prompt, and generates via the
LoRA-adapted gemma-3-4b model.

Usage:
  python rag_inference.py "Spotty brood with bullet-shaped drone cells"
  python rag_inference.py --interactive
"""
import json
import re
import sys
from pathlib import Path

from okf_vocab import load_vocab

# ─── Load ontology (OKF v0.2 bundle; replaced beetree-vocab.yaml) ───
HERE = Path(__file__).resolve().parent
vocab = load_vocab(HERE.parent / "okf")

# ─── Build retrieval index ───
INDEX = []

# Inference rules (brood, comb, queen, varroa, deadout, season)
SECTION_MAP = {
    "brood_inference": "brood_pattern",
    "comb_inference": "comb_condition",
    "queen_inference": "queen_pattern",
    "varroa_inference": "varroa_indicator",
    "deadout_inference": "deadout_pattern",
    "season_phase_inference": "season_phase",
}

for section, typ in SECTION_MAP.items():
    for pid, rule in vocab.get(section, {}).items():
        keywords = pid.replace("_", " ")
        desc = rule.get("description", "")
        keywords += " " + desc
        
        # Add indicates states to keywords
        for ind in rule.get("indicates", []):
            if isinstance(ind, dict):
                keywords += " " + ind.get("state", "")
        
        INDEX.append({
            "type": typ,
            "id": pid,
            "description": desc,
            "indicates": rule.get("indicates", []),
            "diagnosis": rule.get("diagnosis", ""),
            "keywords": keywords,
            "full": rule,
        })

# Threat species with aliases
for sp in vocab.get("threat_species", []):
    keywords = " ".join(filter(None, [
        sp.get("name", ""),
        sp.get("scientific", ""),
        sp.get("kind", ""),
        sp.get("severity", ""),
    ]))
    # Add aliases
    for alias in sp.get("aliases", []):
        keywords += " " + alias
    # Add common names
    keywords += " " + sp.get("name", "").replace("(", "").replace(")", "")
    
    INDEX.append({
        "type": "threat",
        "id": sp.get("id", ""),
        "description": sp.get("name", ""),
        "keywords": keywords,
        "full": sp,
    })

# Season phases with month mappings
SEASON_MONTHS = {
    "January": "Buildup", "February": "Buildup", "March": "Buildup",
    "April": "HoneyFlow", "May": "HoneyFlow", "June": "HoneyFlow",
    "July": "Dearth", "August": "Dearth", "September": "Dearth",
    "October": "WinterCluster", "November": "WinterCluster", "December": "WinterCluster",
}

for phase_name, months in [("Buildup", ["January","February","March"]),
                           ("HoneyFlow", ["April","May","June"]),
                           ("Dearth", ["July","August","September"]),
                           ("WinterCluster", ["October","November","December"])]:
    INDEX.append({
        "type": "season_phase",
        "id": phase_name.lower(),
        "description": f"{phase_name} phase — months: {', '.join(months)}",
        "keywords": phase_name + " " + " ".join(months) + " season phase month",
        "full": {"phase": phase_name, "months": months},
    })

# Colony states
for state in vocab.get("classes", {}).get("Colony", {}).get("inferred_states", []):
    INDEX.append({
        "type": "colony_state",
        "id": state,
        "description": state,
        "keywords": state,
        "full": {"state": state},
    })

# Aliases: DERIVED from the OKF bundle, not hand-maintained here.
#
# This used to be a hardcoded dict, and it silently rotted during the OKF v0.2
# migration: 8 of its 26 entries pointed at ids that do not exist
# (`small_hive_beetle`, `nosema_ceranae`, `greater_wax_moth`, `chalkbrood_fungus`,
# `tropilaelaps_clareae`). A dangling alias does not error -- `retrieve()` finds
# no entry, falls through to keyword search, also finds nothing, and the caller
# answers from parametric memory instead. The eval then records a PASS, so the
# bug was invisible while quietly inflating the score and hiding a real
# retrieval failure. The bundle (`okf/threats/aliases.md`) is the single source
# of truth and had zero dangling entries.
#
# Only aliases that are *regional policy decisions* rather than ontology facts
# belong below. The murder-hornet mapping is the sole case: in Georgia the
# relevant hornet is Vespa velutina (yellow-legged), not Vespa mandarinia, and
# that judgement is not something the bundle should encode.
LOCAL_ALIASES = {
    "murder hornet": "ylh",
    "murder hornets": "ylh",
    "yellow legged hornet": "ylh",
    "yellow-legged hornet": "ylh",
    "yellow-legged": "ylh",
    "vespa velutina": "ylh",
    "northern giant hornet": "ngh",
    "asian giant hornet": "ngh",
    "vespa mandarinia": "ngh",
}

ALIASES = {**load_vocab().get("threat_aliases", {}), **LOCAL_ALIASES}

# Fail at import, not at answer time. A dangling alias is a data bug that the
# eval scores as a success, so it must be impossible to ship one.
_dangling = {a: c for a, c in ALIASES.items() if c not in {e["id"] for e in INDEX}}
if _dangling:
    raise RuntimeError(
        "dangling threat alias(es) -- target id is not in the index: "
        + ", ".join(f"{a!r}->{c!r}" for a, c in sorted(_dangling.items()))
        + ". Fix okf/threats/aliases.md or LOCAL_ALIASES; do not silence this."
    )


STOP_WORDS = {'the','a','an','is','are','of','in','on','my','me','i','see','seeing',
              'looks','look','about','what','how','should','this','that','there',
              'and','or','to','with','for','it','be','at','by','from','some',
              'really','very','quite','bit','kind','sort','type','tell','me',
              'worry','concerned','question','ask','know','think','guess'}

# DOMAIN NOUNS ARE NOT STOP WORDS.
#
# This list used to also strip: hive, hives, colony, colonies, frame, frames,
# comb, combs, brood, bees, bee, cells, cell, capped, uncapped, empty.
#
# The reasoning was presumably that those words occur in almost every query, so
# they carry no discriminative signal. That is exactly backwards for this
# ontology: they are the terms that separate burr_comb from cross_comb from
# brace_comb, and solid_capped from spotty. Stripping them collapsed queries to
# nothing -- "How often should I rotate my brood comb?" reduced to
# {often, rotate} and matched zero entries, while the answer sat in the bundle.
#
# A term that appears in EVERY query is harmless: it contributes equally to all
# candidates and cannot reorder them. A term that appears in SOME queries is the
# signal. Never strip a domain noun to reduce noise; strip function words only.

def retrieve(query: str, top_k: int = 5) -> list:
    """Keyword-based retrieval over the ontology index."""
    q_lower = query.lower()
    
    # Check aliases first — exact match overrides keyword search
    for alias, canonical in ALIASES.items():
        if alias in q_lower:
            for entry in INDEX:
                if entry["id"] == canonical or entry["id"] == canonical.replace("_", " "):
                    return [entry] + retrieve_keywords(query, top_k - 1, exclude=canonical)
    
    # Check season month queries
    for month, phase in SEASON_MONTHS.items():
        if month.lower() in q_lower and ("phase" in q_lower or "season" in q_lower or month.lower() == q_lower.strip()):
            for entry in INDEX:
                if entry["type"] == "season_phase" and entry["id"] == phase.lower():
                    return [entry] + retrieve_keywords(query, top_k - 1, exclude=phase.lower())
    
    return retrieve_keywords(query, top_k)

def retrieve_keywords(query: str, top_k: int, exclude: str = "") -> list:
    q_lower = query.lower()
    q_words = set(re.findall(r'[a-z]+', q_lower)) - STOP_WORDS
    
    scored = []
    for entry in INDEX:
        if entry["id"] == exclude:
            continue
        kw_lower = entry["keywords"].lower()
        kw_words = set(re.findall(r'[a-z]+', kw_lower))
        
        overlap = len(q_words & kw_words)
        
        # Substring bonus
        for qw in q_words:
            if len(qw) > 3 and qw in kw_lower:
                if qw not in kw_words:
                    overlap += 0.5
        
        if overlap > 0:
            scored.append((overlap, entry))
    
    scored.sort(key=lambda x: -x[0])
    return [e for _, e in scored[:top_k]]

def build_context(entries: list) -> str:
    """Build a context string from retrieved entries."""
    if not entries:
        return "No relevant ontology entries found."
    
    parts = []
    for entry in entries:
        full = entry["full"]
        if isinstance(full, dict):
            parts.append(json.dumps(full, indent=2, default=str))
        else:
            parts.append(str(full))
    
    return "\n\n---\n\n".join(parts)

def build_prompt(query: str, context: str) -> str:
    """Build a context-augmented prompt for the LoRA model."""
    return f"""You are a certified beekeeper's assistant. Use ONLY the ontology context below to answer the beekeeper's observation. If the context doesn't contain the answer, say you don't know — do not invent facts.

ONTOLOGY CONTEXT:
{context}

BEEKEEPER: {query}

ASSISTANT:"""

def generate_mlx(prompt: str, max_tokens: int = 512) -> str:
    """Generate via MLX with LoRA adapter."""
    import subprocess
    sys.path.insert(0, str(HERE))
    from _common import venv_python
    PY = venv_python()
    code = f'''
import sys
sys.path.insert(0, "{HERE}")
from mlx_lm import load, generate
model, tokenizer = load("mlx-community/gemma-3-text-12b-it-4bit", adapter_path="{HERE}/adapters")
response = generate(model, tokenizer, prompt={repr(prompt)}, max_tokens={max_tokens}, verbose=False)
print(response)
'''
    result = subprocess.run([PY, "-c", code], capture_output=True, text=True, timeout=120)
    return result.stdout.strip()

def answer(query: str) -> dict:
    """Full RAG pipeline: retrieve → context → prompt → generate."""
    entries = retrieve(query, top_k=5)
    context = build_context(entries)
    prompt = build_prompt(query, context)
    response = generate_mlx(prompt)
    
    return {
        "query": query,
        "retrieved": [{"type": e["type"], "id": e["id"]} for e in entries],
        "context": context[:500] + "..." if len(context) > 500 else context,
        "response": response,
    }

if __name__ == "__main__":
    if "--interactive" in sys.argv:
        print("BeeTree RAG + LoRA (interactive mode, Ctrl+C to exit)")
        while True:
            try:
                q = input("\n Beekeeper> ")
                if q.strip():
                    result = answer(q)
                    print(f"\n📋 Retrieved: {', '.join(r['type']+':'+r['id'] for r in result['retrieved'])}")
                    print(f"\n🐝 {result['response']}")
            except KeyboardInterrupt:
                print("\nBye!")
                break
    else:
        q = " ".join(sys.argv[1:]) or "Spotty brood with bullet-shaped drone cells"
        result = answer(q)
        print(f"Query: {result['query']}")
        print(f"Retrieved: {', '.join(r['type']+':'+r['id'] for r in result['retrieved'])}")
        print(f"\nResponse:\n{result['response']}")