# BeeTree Ontology → LLM Pipeline

Trains `gemma-3-4b-it` 4-bit LoRA on synthetic ontology instructions so the model internalizes:
- The 31-species threat catalog + aliases (kettlebeetle → small hive beetle)
- Colony state vocabulary (Queenright, SwarmPrep, etc.) + confidence framing
- Yard entity graph (live state from `onto_entity` / `onto_relation` / `onto_instantiation`)
- Season phase reasoning (middle-GA defaults from vocab YAML)
- Undefined behavior (unknown pest/predicate → checkpoint with user)

## Quickstart

```bash
# 1. Generate fresh instructions from ontology + DB
uv run --with pyyaml training/generate_instructions.py

# 2. Chat-format split (train/valid)
python3 training/prepare_dataset.py

# 3. Train (smoke = 20 iters sanity, full = 3 epochs)
python3 training/run_lora.py smoke
python3 training/run_lora.py full

# 4. Behavior eval (10 hand-picked cases)
python3 training/eval_quick.py --verbose

# 5. Export GGUF + register in Ollama
bash training/export_gguf.sh
```

## Layout

| File | Purpose |
|---|---|
| `generate_instructions.py` | Vocab YAML + SQLite → Alpaca JSONL (~550 examples) |
| `prepare_dataset.py` | Alpaca JSONL → chat-JSONL train/valid split |
| `train_lora.sh` | *(superceded by run_lora.py — kept for reference)* |
| `run_lora.py` | mlx-lm CLI driver (smoke/full/chat modes) |
| `eval_quick.py` | Hand-picked behavioral evals vs adapter |
| `export_gguf.sh` | Fuse + convert + quantize + ollama register |
| `data/` | instructions.jsonl, train.jsonl, valid.jsonl |
| `adapters/` | LoRA adapter weights (after training) |
| `fused/` | Merged model (after fuse step) |
| `gguf/` | GGUF exports + Modelfile |

## Model card

- **Base:** `mlx-community/gemma-3-4b-it-4bit` (~2.5GB download)
- **LoRA:** rank=8 (default), alpha=16 (default), 16 layers, batch 4, lr 1e-4, 3 epochs
- **Trainable params:** 7.01M / 4.55B (0.154%)
- **Peak training memory:** 4.33GB (Mini has 12GB free)
- **Training time:** ~25 minutes on M4 for 372 iters

## Serving

- **Mini (dev):** Ollama model `beetree:4b-lora` (Q5_K_M ~2.9GB)
- **Pi 5 (product):** Q4_K_M GGUF (~2.6GB) via `llama-server` OpenAI-compatible endpoint
  - Pi 5 2GB RAM budget check: Node 250MB + SQLite ~50MB + OS ~300MB + GGUF 2.2GB = ~2.8GB → **tight, may need Q3_K_M or skip Node on Pi**
  - Verify at deploy time with `free -h` before/after

## Retraining

Any time the vocab YAML changes or the yard DB grows materially:

```bash
# Full re-run, ~30 min end-to-end
cd ~/beetree
uv run --with pyyaml training/generate_instructions.py
python3 training/prepare_dataset.py
python3 training/run_lora.py full
python3 training/eval_quick.py > training/eval_report.txt
bash training/export_gguf.sh
```

Pin a git tag `lora/YYYYMMDD` so rollback is one command:

```bash
git tag lora/$(date +%Y%m%d) && git push --tags
```

## Gotchas

- **Terminal tool chokes on `-m mlx_lm`** in Python module position — use `run_lora.py` wrapper, not direct invocation.
- **`vx.run_lora.py` chat mode:** the gemma template is idiosyncratic; always use `<start_of_turn>user\n...<end_of_turn>\n<start_of_turn>model\n`.
- **Don't skip the eval.** Threat aliasing can silently regress if you add a new alias column to the YAML without updating tests.
- **Pi 5 memory:** before shipping, test with `systemd-cgtop` on a real Pi. If RSS > 1.6GB sustained, drop to Q3_K_M.
