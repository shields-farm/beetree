# BeeTree ML Training Setup

Machine learning pipeline for BeeTree beehive monitoring system.

## Structure

```
beetree/
├── README.md
├── .gitignore
├── phase1_sensor_baseline/     # Phase 1: sensor-only colony strength model
│   ├── beetree_phase1.py       # Temp/humidity/weather → frames of bees
│   └── results.md              # MAE=2.89 fob, Corr=0.848
├── phase2_audio/               # Phase 2: audio → colony strength (CNN/CRDNN)
│   ├── beetree_audio_pipeline.py  # Download + tensorgram extraction
│   └── tensorgram_model.py     # CNN/CRDNN architecture (TBD)
├── phase3_llm/                 # Phase 3: Gemma 4 fine-tuning (beekeeping advisor)
│   ├── beetree_finetuning_dataset.py  # Dataset generator
│   ├── finetuning/             # Generated training data
│   └── finetune_gemma4.py      # Fine-tuning script (TBD)
├── data/                       # Reference data (UrBAN annotations only)
│   └── annotations/            # Inspection CSVs (CC BY 4.0)
└── docs/
    ├── paper_summary.md        # arXiv 2607.20386 summary
    └── architecture.md         # System architecture
```

## Phases

### Phase 1 — Sensor Baseline (DONE)
- Input: BroodMinder temp/humidity + weather
- Model: Random Forest regression
- Result: MAE=2.89 fob (clipped), Corr=0.848
- Status: ✅ Validated on build-host

### Phase 2 — Audio Colony Strength (IN PROGRESS)
- Input: In-hive audio (16kHz WAV) → modulation tensorgrams
- Model: CNN/CRDNN (from arXiv 2607.20386)
- Data: UrBAN dataset (FRDR, CC BY 4.0)
- Status: 🟡 Audio download in progress, tensorgram pipeline written

### Phase 3 — Beekeeping Advisor LLM (IN PROGRESS)
- Model: Gemma 4 E4B QAT (GGUF via Ollama)
- Training: 119 Q&A pairs from UrBAN inspections + curriculum
- Target: Pi 5 4GB inference
- Status: 🟡 Dataset generated, fine-tuning script TBD

## License
- BeeTree code: Proprietary (the BeeTree contributors)
- UrBAN data/annotations: CC BY 4.0 (attribution required)
- Trained models: Proprietary (trained on own data for commercial product)