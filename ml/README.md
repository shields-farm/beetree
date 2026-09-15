# BeeTree ML — Training Pipeline

Machine learning pipeline for BeeTree beehive monitoring. Lives under `ml/` in the BeeTree repo.

## Phases

### Phase 1 — Sensor Baseline (DONE)
- `phase1_sensor_baseline/beetree_phase1.py`
- Input: BroodMinder temp/humidity + weather → Random Forest
- Result: MAE=2.89 frames of bees (clipped), Corr=0.848

### Phase 2 — Audio Colony Strength (IN PROGRESS)
- `phase2_audio/beetree_audio_pipeline.py` — download + tensorgram extraction
- `phase2_audio/frdr_zip_watcher.sh` — FRDR zip download watcher
- Input: In-hive audio (16kHz) → modulation tensorgrams → CNN/CRDNN
- Data: UrBAN dataset (FRDR DOI 10.20383/103.0972, CC BY 4.0)

### Phase 3 — Beekeeping Advisor LLM (IN PROGRESS)
- `phase3_llm/beetree_finetuning_dataset.py` — dataset generator
- `phase3_llm/finetuning/beetree_finetuning.jsonl` — 119 Q&A pairs
- Model: Gemma 4 E4B QAT (GGUF via Ollama on Pi 5)
- Target: Pi 5 4GB (E4B) or Pi 5 2GB (E2B fallback)

## Data
- `data/annotations/` — UrBAN inspection CSVs (CC BY 4.0)
- Audio data is NOT in git — too large (1.27 TB). See `phase2_audio/` scripts.

## License
- UrBAN data: CC BY 4.0 (attribution required)
- BeeTree code: MIT (see `../LICENSE`)
- Trained models: own terms — trained on UrBAN data plus project curriculum