#!/usr/bin/env python3
"""
BeeTree on-device inference server.

Persistent Python HTTP server that:
1. Loads the LoRA-adapted model once at startup
2. Serves /infer requests with RAG retrieval + generation
3. Serves /retrieve requests with just the ontology lookup (no LLM)

Runs on port 3002 — BeeTree's Express server proxies to it.
"""
import json
import re
import sys
import yaml
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOCAB_PATH = HERE.parent / "server" / "ontology" / "beetree-vocab.yaml"
MODEL = "mlx-community/gemma-3-text-12b-it-4bit"
ADAPTER = str(HERE / "adapters")

# ─── Load ontology ───
with open(VOCAB_PATH) as f:
    vocab = yaml.safe_load(f)

# ─── Build retrieval index ───
INDEX = []
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
        keywords = pid.replace("_", " ") + " " + rule.get("description", "")
        for ind in rule.get("indicates", []):
            if isinstance(ind, dict):
                keywords += " " + ind.get("state", "")
        INDEX.append({
            "type": typ, "id": pid,
            "description": rule.get("description", ""),
            "indicates": rule.get("indicates", []),
            "diagnosis": rule.get("diagnosis", ""),
            "keywords": keywords,
            "full": rule,
        })

for sp in vocab.get("threat_species", []):
    keywords = " ".join(filter(None, [
        sp.get("name", ""), sp.get("scientific", ""), sp.get("kind", ""),
    ]))
    for alias in sp.get("aliases", []):
        keywords += " " + alias
    INDEX.append({
        "type": "threat", "id": sp.get("id", ""),
        "description": sp.get("name", ""),
        "keywords": keywords,
        "full": sp,
    })

SEASON_MONTHS = {
    "january": "Buildup", "february": "Buildup", "march": "Buildup",
    "april": "HoneyFlow", "may": "HoneyFlow", "june": "HoneyFlow",
    "july": "Dearth", "august": "Dearth", "september": "Dearth",
    "october": "WinterCluster", "november": "WinterCluster", "december": "WinterCluster",
}

for phase_name, months in [("Buildup", ["January","February","March"]),
                           ("HoneyFlow", ["April","May","June"]),
                           ("Dearth", ["July","August","September"]),
                           ("WinterCluster", ["October","November","December"])]:
    INDEX.append({
        "type": "season_phase", "id": phase_name.lower(),
        "description": f"{phase_name} phase — months: {', '.join(months)}",
        "keywords": phase_name + " " + " ".join(months) + " season phase month",
        "full": {"phase": phase_name, "months": months},
    })

for state in vocab.get("classes", {}).get("Colony", {}).get("inferred_states", []):
    INDEX.append({"type": "colony_state", "id": state, "description": state,
                  "keywords": state, "full": {"state": state}})

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
    "tropi": "tropilaelaps", "tropilaelaps": "tropilaelaps_clareae",
    "varroa": "varroa_destructor", "varroa mite": "varroa_destructor",
    "varroa mites": "varroa_destructor",
    "foulbrood": "afb", "american foulbrood": "afb", "european foulbrood": "efb",
    "wax moth": "greater_wax_moth", "wax moths": "wax_moths",
    "small hive beetle": "small_hive_beetle", "shb": "small_hive_beetle",
    "hive beetle": "small_hive_beetle",
    "tracheal mite": "tracheal_mites", "nosema": "nosema_ceranae",
    "chalkbrood": "chalkbrood_fungus",
}

STOP_WORDS = {'the','a','an','is','are','of','in','on','my','me','i','see','seeing',
              'looks','look','about','what','how','should','this','that','there',
              'and','or','to','with','for','it','be','at','by','from','some',
              'really','very','quite','bit','kind','sort','type','tell','me',
              'worry','concerned','question','ask','know','think','guess'}

def retrieve(query, top_k=5):
    q_lower = query.lower()
    results = []

    # Alias exact match
    for alias, canonical in ALIASES.items():
        if alias in q_lower:
            for entry in INDEX:
                if entry["id"] == canonical:
                    results.append(entry)
                    break

    # Season month match
    for month, phase in SEASON_MONTHS.items():
        if month in q_lower and ("phase" in q_lower or "season" in q_lower):
            for entry in INDEX:
                if entry["type"] == "season_phase" and entry["id"] == phase.lower():
                    if entry not in results:
                        results.append(entry)
                    break

    # Keyword overlap
    q_words = set(re.findall(r'[a-z]+', q_lower)) - STOP_WORDS
    scored = []
    seen_ids = {r["id"] for r in results}
    for entry in INDEX:
        if entry["id"] in seen_ids:
            continue
        kw_words = set(re.findall(r'[a-z]+', entry["keywords"].lower()))
        overlap = len(q_words & kw_words)
        for qw in q_words:
            if len(qw) > 3 and qw in entry["keywords"].lower() and qw not in kw_words:
                overlap += 0.5
        if overlap > 0:
            scored.append((overlap, entry))

    scored.sort(key=lambda x: -x[0])
    for _, entry in scored[:top_k - len(results)]:
        results.append(entry)

    return results[:top_k]

def build_context(entries):
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

def build_prompt(query, context):
    return f"""You are a certified beekeeper's assistant in Georgia, USA. Use ONLY the ontology context below to answer the beekeeper's observation. If the context doesn't contain the answer, say you don't know — do not invent facts. When the context includes multiple related entries, synthesize them clearly. Be concise and direct.

ONTOLOGY CONTEXT:
{context}

BEEKEEPER: {query}

ASSISTANT:"""

# ─── Load model once at startup ───
print(f"[infer] Loading {MODEL} + adapter {ADAPTER}...")
_model = None
_tokenizer = None

def load_model():
    global _model, _tokenizer
    if _model is None:
        from mlx_lm import load
        _model, _tokenizer = load(MODEL, adapter_path=ADAPTER)
        print(f"[infer] Model loaded.")
    return _model, _tokenizer

def generate(prompt, max_tokens=512):
    model, tokenizer = load_model()
    from mlx_lm import generate as mlx_generate
    response = mlx_generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens, verbose=False)
    return response

# ─── HTTP server ───
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/infer":
            self._handle_infer()
        elif self.path == "/retrieve":
            self._handle_retrieve()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "model_loaded": _model is not None})
        else:
            self.send_error(404)

    def _json(self, data, code=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _handle_retrieve(self):
        body = self._read_body()
        query = body.get("query", "")
        top_k = body.get("top_k", 5)
        entries = retrieve(query, top_k)
        self._json({
            "query": query,
            "results": [{"type": e["type"], "id": e["id"],
                         "description": e.get("description", ""),
                         "full": e["full"]} for e in entries],
        })

    def _handle_infer(self):
        body = self._read_body()
        query = body.get("query", "")
        max_tokens = body.get("max_tokens", 512)

        entries = retrieve(query, top_k=5)
        context = build_context(entries)
        prompt = build_prompt(query, context)

        try:
            response = generate(prompt, max_tokens)
        except Exception as e:
            return self._json({"error": str(e)}, 500)

        self._json({
            "query": query,
            "retrieved": [{"type": e["type"], "id": e["id"]} for e in entries],
            "context": context,
            "response": response,
        })

    def log_message(self, *args):
        pass  # suppress default logging

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3002
    # Load model in main thread (MLX requires same-thread stream)
    print(f"[infer] Loading {MODEL} + adapter {ADAPTER}...")
    load_model()
    print(f"[infer] Model loaded. Starting server on port {port}.")
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[infer] Listening on http://127.0.0.1:{port}")
    server.serve_forever()