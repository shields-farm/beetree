# BeeTree Architecture

## System Overview

BeeTree is a beehive monitoring system combining sensor data and acoustic analysis
to provide beekeepers with real-time colony health assessments.

## Two-Model Architecture

### Model 1: Audio → Colony Strength (CNN/CRDNN)
- **Input**: 60-second audio windows at 16kHz from the custom sensor PDM microphone
- **Feature extraction**: Modulation tensorgrams (~44KB per window)
- **Architecture**: CNN with optional CRDNN (recurrent layers for temporal context)
- **Output**: Frames of bees (regression) or 3-class (weak/medium/strong)
- **Training data**: UrBAN dataset (7,011 + 49,965 WAVs, CC BY 4.0)
- **Deployment**: ONNX runtime on Pi 5

### Model 2: Beekeeping Advisor (Gemma 4 E4B QAT)
- **Input**: Text (beekeeper questions) + optionally audio embeddings from Model 1
- **Architecture**: Gemma 4 E4B with QAT (quantization-aware training)
- **Fine-tuning**: 119+ Q&A pairs from inspection notes + curriculum + acoustic knowledge
- **Output**: Natural language beekeeping advice
- **Deployment**: GGUF via Ollama on Pi 5 4GB (E4B) or Pi 5 2GB (E2B fallback)

## Hardware Pipeline

```
the custom sensor (PDM mic + temp/humidity + LoRa)
    ↓
LoRa Repeater → BeeTree Hub (Pi 5)
    ↓
Audio → Model 1 (CNN/CRDNN) → colony strength score
Sensors → InfluxDB → dashboard
    ↓
Strength score + sensor data → Model 2 (Gemma 4) → advice
    ↓
Web dashboard + alerts (Slack/email/SMS)
```

## Data Flow

1. **the custom sensor** samples audio (60s windows) + temp/humidity (15-min intervals)
2. **LoRa repeater** forwards to BeeTree Hub (Pi 5)
3. **Pi 5** runs Model 1 (ONNX) on audio → frames of bees prediction
4. **Pi 5** runs Model 2 (Ollama GGUF) for natural language advice
5. **InfluxDB** stores all sensor + prediction time series
6. **Web dashboard** (Grafana or custom) displays trends + alerts

## Training Pipeline

```
Phase 1 (DONE): Sensor-only baseline
  BroodMinder temp/humidity + weather → RF regression → MAE=2.89 fob

Phase 2 (IN PROGRESS): Audio model
  UrBAN WAVs → tensorgrams → CNN/CRDNN → frames of bees
  Validate on UrBAN, then retrain on BeeTree proprietary data

Phase 3 (IN PROGRESS): LLM advisor
  UrBAN inspections + curriculum + acoustic knowledge → Gemma 4 E4B QAT
  Fine-tune for Georgia beekeeping context
```

## Licensing Strategy

- **UrBAN data**: CC BY 4.0 — can use commercially with attribution
- **BeeTree code**: Proprietary (the BeeTree contributors)
- **Trained models**: 
  - Model 1 trained on UrBAN: CC BY 4.0 (derivative)
  - Model 1 retrained on BeeTree data: Proprietary
  - Model 2 (Gemma 4): Apache 2.0 base + proprietary fine-tune

## References

- arXiv 2607.20386: Modulation tensorgrams + CNN/CRDNN for bee colony strength
- UrBAN dataset: FRDR DOI 10.20383/103.0972 (CC BY 4.0)
- Gemma 4: Google, Apache 2.0, E4B (4B effective params, native audio)
- GitHub: https://github.com/mahsa-abdollahi/UrBAN (traditional ML code)