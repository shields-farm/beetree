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
import yaml
from pathlib import Path

# ─── Load ontology ───
HERE = Path(__file__).resolve().parent
VOCAB_PATH = HERE.parent / "server" / "ontology" / "beetree-vocab.yaml"

with open(VOCAB_PATH) as f:
    vocab = yaml.safe_load(f)

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

# Common aliases / colloquial names → canonical
ALIASES = {
    "murder hornet": "ylh",  # GA context → yellow-legged hornet (Vespa velutina), not northern giant hornet
    "murder hornets": "ylh",
    "yellow legged hornet": "ylh",
    "yellow-legged hornet": "ylh",
    "yellow-legged": "ylh",
    "vespa velutina": "ylh",
    "northern giant hornet": "ngh",
    "asian giant hornet": "ngh",
    "vespa mandarinia": "ngh",
    "kettlebeetle": "small_hive_beetle",
    "tropi": "tropilaelaps",
    "tropilaelaps": "tropilaelaps_clareae",
    "varroa": "varroa_destructor",
    "varroa mite": "varroa_destructor",
    "varroa mites": "varroa_destructor",
    "foulbrood": "afb",
    "american foulbrood": "afb",
    "european foulbrood": "efb",
    "wax moth": "greater_wax_moth",
    "wax moths": "wax_moths",
    "small hive beetle": "small_hive_beetle",
    "shb": "small_hive_beetle",
    "hive beetle": "small_hive_beetle",
    "tracheal mite": "tracheal_mites",
    "nosema": "nosema_ceranae",
    "chalkbrood": "chalkbrood_fungus",
}

STOP_WORDS = {'the','a','an','is','are','of','in','on','my','me','i','see','seeing',
              'looks','look','about','what','how','should','this','that','there',
              'and','or','to','with','for','it','be','at','by','from','some',
              'really','very','quite','bit','kind','sort','type','tell','me',
              'worry','concerned','question','ask','know','think','guess',
              'hive','hives','colony','colonies','frame','frames','comb','combs',
              'brood','bees','bee','cells','cell','capped','uncapped','empty'}

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
    PY = "/Users/developer/.venvs/beetree-train/bin/python"
    code = f'''
import sys
sys.path.insert(0, "{HERE}")
from mlx_lm import load, generate
model, tokenizer = load("mlx-community/gemma-3-4b-it-4bit", adapter_path="{HERE}/adapters")
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