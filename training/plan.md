# BeeTree Ontology Model Pairing — Plan

**Goal:** Gemma 3 4B LoRA, trained once on the Mac Mini, same weights shipped everywhere (Mini via Ollama, Pi 5 via llama.cpp Q4_K_M). No distillation step.

## Architecture

```
Ontology (vocab YAML + yard DB)
    ↓
Training data generator (synthetic instructions)
    ↓
LoRA fine-tune (gemma3:4b via mlx-lm, 4-bit)
    ↓
Export: merge LoRA → convert GGUF (llama.cpp)
    ↓
├─→ Mac Mini: Ollama serve (Q5_K_M ~3GB)
└─→ Pi 5: llama.cpp Q4_K_M (~2.5GB, fits 2GB RAM w/ headroom? → verify; else Q3_K_M)
```

## Phase 1: Training Data Generation

Extract synthetic instruction examples from ontology + live yard state. Target: ~1,000 examples.

### Categories

1. **Threat lookup** (500 ex)
   - Input: "What's kettlebeetle?"
   - Output: "Small hive beetle (Aethina tumida). Larvae slime comb; weak colonies at risk. Vector of: dwv, bqcv, sbv, abpv."

2. **Season reasoning** (200 ex)
   - Input: "What season is it?"
   - Output: "We're in Buildup (January–March). Temperatures 4–18°C. Hives are ramping up brood production."

3. **Entity graph queries** (200 ex)
   - Input: "What's on hive-1?"
   - Output: "hive-1 is on branch 'home-apiary'. Sensors: TH-01 (temp), TH-02 (temp+humidity). Colony: colony-alpha."

4. **Colony state inference** (100 ex)
   - Input: "Is hive-1 queenright?"
   - Output: "Yes — queenright with 50% confidence (bootstrap: inferred from attached sensor, unverified by inspection)."

5. **Relations + actions** (100 ex)
   - Input: "Hive 2 has varroa."
   - Output: "I'll add that to the graph: hive-2 detectedIn varroa_destructor (confidence 1.0). Treatment window: now through fall. Notifiable: no. Next step: oxalic acid vaporization or alcohol wash count first."

### Format

JSONL with `instruction`, `input`, `output` fields. Alpaca style, but with tool-call schemas prepended when relevant.

## Phase 2: LoRA Fine-Tune (Mac Mini)

- **Model:** `google/gemma-3-4b-it` (Gemma license, research/commercial OK)
- **Framework:** mlx-lm (Apple Silicon optimized)
- **LoRA config:** rank=8, alpha=16, dropout=0.05, target=attention+feedforward
- **Quantization during training:** 4-bit (fit in ~8GB)
- **Batch:** 4, epochs: 3, lr: 1e-4
- **Validation:** 10% holdout, perplexity + threat-lookup accuracy
- **Tool-call JSON validation:** gemma3 template sometimes wraps JSON in extra tokens — validate early on a 20-example smoke run before the full train

## Phase 3: Export + Serve

1. Merge LoRA into base model
2. Convert to GGUF (llama.cpp)
3. Quantize to Q5_K_M (~5GB) for Mini, Q4_K_M (~2.5GB) for Pi-compat
4. Register in Ollama: `ollama create beetree:8b-lora`
5. Register in Hermes config: `beetree:8b-lora` as provider

## Phase 4: Ship to Pi 5

No distillation needed — same 4B LoRA weights:

1. **Quantize GGUF** to Q4_K_M (~2.5GB file, ~2.2GB RAM at runtime with small context) — verify fits Pi 5 2GB alongside BeeTree Node + SQLite. Fallback: Q3_K_M (~1.9GB) or IQ3_XXS.
2. **Serve via llama.cpp `llama-server`** with the same OpenAI-compatible endpoint BeeTree already speaks.
3. **Context budget:** 4K context on Pi (RAM-constrained), 8–32K on Mini.

## Hardware Constraints

- **Mac Mini (M4, 16GB, ~12GB free):** Trains gemma3:4b in 4-bit LoRA comfortably (~6–8GB). Training time: ~1.5–3 hours for 3 epochs on 1k examples.
- **Pi 5 2GB:** gemma3:4b at Q4_K_M is ~2.2GB RAM — tight against Node + SQLite + OS. May need Q3_K_M. Verify RAM at serve time before committing the product image.

## Deliverables

- `training/generate_instructions.py` — extract 1k synthetic examples
- `training/train_lora.py` — mlx-lm LoRA training loop
- `training/export_gguf.sh` — merge + quantize + register
- `README.md` — quickstart guide

## Success Metrics

- Threat-lookup accuracy: >95% on holdout set
- Season reasoning: correct month/phase mapping
- Tool-call JSON validity: 100%
- Inference latency (Pi 5): <5s for 100-token response
- Memory footprint (Pi 5): Q4_K_M fits alongside Node+SQLite+OS, or fall back to Q3_K_M
