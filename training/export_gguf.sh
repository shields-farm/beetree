#!/usr/bin/env bash
# export_gguf.sh — merge LoRA adapters into base model, convert to GGUF, quantize, register in Ollama.
#
# Usage:
#   bash training/export_gguf.sh
#
# Steps:
#   1. mlx_lm.fuse: merge adapters into gemma-3-4b-it-4bit → training/fused/
#   2. convert_hf_to_gguf.py: HF safetensors → GGUF (via llama.cpp)
#   3. llama-quantize: FP16 GGUF → Q4_K_M (Pi) + Q5_K_M (Mini)
#   4. ollama create beetree:4b-lora
#
# Requires: llama.cpp built at ~/src/llama.cpp (or set LLAMA_CPP_DIR).

set -euo pipefail
cd "$(dirname "$0")/.."

PY="/Users/developer/.venvs/beetree-train/bin/python"
BASE="mlx-community/gemma-3-4b-it-4bit"
ADAPTER="training/adapters"
FUSED="training/fused"
GGUF_F16="training/gguf/beetree-4b-lora-f16.gguf"
GGUF_Q4="training/gguf/beetree-4b-lora-q4_k_m.gguf"
GGUF_Q5="training/gguf/beetree-4b-lora-q5_k_m.gguf"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$HOME/src/llama.cpp}"

if [ ! -d "$ADAPTER" ]; then
  echo "[error] no adapters at $ADAPTER — run training first" >&2
  exit 1
fi

echo "[1/4] Fusing adapters into base model"
$PY -m mlx_lm fuse \
  --model "$BASE" \
  --adapter-path "$ADAPTER" \
  --save-path "$FUSED" \
  --de-quantize

echo "[2/4] Converting fused HF model → GGUF (FP16)"
mkdir -p training/gguf
if [ ! -f "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" ]; then
  echo "[setup] llama.cpp not found at $LLAMA_CPP_DIR — cloning"
  git clone --depth=1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP_DIR"
fi
$PY "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" "$FUSED" \
  --outfile "$GGUF_F16" \
  --outtype f16

echo "[3/4] Quantizing"
if [ ! -x "$LLAMA_CPP_DIR/build/bin/llama-quantize" ]; then
  echo "[setup] building llama.cpp"
  cmake -B "$LLAMA_CPP_DIR/build" -S "$LLAMA_CPP_DIR" -DGGML_METAL=ON -DBUILD_SHARED_LIBS=OFF
  cmake --build "$LLAMA_CPP_DIR/build" --config Release -j llama-quantize llama-cli
fi
"$LLAMA_CPP_DIR/build/bin/llama-quantize" "$GGUF_F16" "$GGUF_Q4" Q4_K_M
"$LLAMA_CPP_DIR/build/bin/llama-quantize" "$GGUF_F16" "$GGUF_Q5" Q5_K_M

echo "[4/4] Registering in Ollama"
cat > training/gguf/Modelfile <<EOF
FROM $GGUF_Q5
TEMPLATE """{{ if .System }}<start_of_turn>system
{{ .System }}<end_of_turn>
{{ end }}{{ if .Prompt }}<start_of_turn>user
{{ .Prompt }}<end_of_turn>
{{ end }}<start_of_turn>model
{{ .Response }}<end_of_turn>
"""
PARAMETER stop "<start_of_turn>"
PARAMETER stop "<end_of_turn>"
EOF
ollama create beetree:4b-lora -f training/gguf/Modelfile

echo ""
echo "Done. Test:"
echo "  ollama run beetree:4b-lora 'What is small hive beetle?'"
echo "  curl http://localhost:11434/v1/chat/completions -d '{\"model\":\"beetree:4b-lora\",\"messages\":[{\"role\":\"user\",\"content\":\"What is varroa?\"}]}'"
echo ""
echo "Pi 5 artifact:"
echo "  $GGUF_Q4  (~2.6GB)"
