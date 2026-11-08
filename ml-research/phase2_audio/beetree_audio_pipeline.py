#!/usr/bin/env python3
"""
BeeTree Audio Pipeline: Download UrBAN audio → extract modulation tensorgrams → delete WAVs.

Processes one tar.gz at a time:
  1. Download tar.gz to staging drive
  2. Extract WAVs
  3. Compute modulation tensorgrams (20×40×14 per 60s window)
  4. Save features + labels to ZFS
  5. Delete WAVs + tar.gz from staging
  6. Repeat

The entire feature dataset is ~530 MB. Raw audio is disposable.

Usage:
  python3 beetree_audio_pipeline.py --download   # Download + extract features
  python3 beetree_audio_pipeline.py --local-only  # Process already-downloaded tar.gz files
"""

import os
import sys
import json
import glob
import tarfile
import argparse
import subprocess
import numpy as np
import pandas as pd
import librosa
from pathlib import Path
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings("ignore")

# === Configuration ===
STAGING_DIR = "/data/staging/urban-audio"
FEATURES_DIR = "/data/beetree-ml-features"
INSPECTIONS_2021 = "data/annotations/inspections_2021.csv"
INSPECTIONS_2022 = "data/annotations/inspections_2022.csv"

# Modulation tensorgram parameters (from the paper)
STFT_WINDOW_MS = 100  # short-term STFT window
STFT_HOP_MS = 12.5    # short-term STFT hop
MOD_WINDOW_S = 60     # long-term modulation analysis window (seconds)
MOD_HOP_S = 60         # no overlap
ACOUSTIC_FREQ_MAX = 1000  # Hz, bee sounds concentrate below this
N_ACOUSTIC_BINS = 20   # grouped acoustic frequency bins
N_MOD_BINS = 40        # grouped modulation frequency bins
SAMPLE_RATE = 16000    # UrBAN audio sample rate

# FRDR download URLs — we'll need to discover these from the dataset page
# The dataset has 18 tar.gz for 2021 + 131 tar.gz for 2022
# We'll try the FRDR download API

def load_labels():
    """Load inspection labels and build a lookup: (hive_id, datetime) → fob."""
    # 2021
    df21 = pd.read_csv(INSPECTIONS_2021)
    df21 = df21.fillna(0)
    df21["Date"] = pd.to_datetime(df21["Date"])
    df21["fob_total"] = df21[["Fob 1st", "Fob 2nd", "Fob 3rd"]].astype(float).sum(axis=1)
    
    # 2022
    df22 = pd.read_csv(INSPECTIONS_2022)
    df22["Date"] = pd.to_datetime(df22["Date"], errors="coerce").dt.date
    df22 = df22[df22["Category"] == "frames of bees"].copy()
    df22["fob_total"] = pd.to_numeric(df22["Action detail"], errors="coerce")
    df22 = df22.dropna(subset=["fob_total"])
    
    # Build label lookup with forward-fill: each inspection label applies
    # until the next inspection for that hive
    labels = []
    for _, row in pd.concat([
        df21[["Tag number", "Date", "fob_total"]].assign(year=2021),
        df22[["Tag number", "Date", "fob_total"]].assign(year=2022),
    ], ignore_index=True).iterrows():
        labels.append({
            "hive": int(row["Tag number"]),
            "date": row["Date"],
            "fob": float(row["fob_total"]),
            "year": int(row["year"]),
        })
    
    labels_df = pd.DataFrame(labels).sort_values(["hive", "date"])
    return labels_df

def get_fob_for_audio(labels_df, hive_id, audio_datetime):
    """
    Get the most recent fob label for a hive at a given datetime.
    Forward-fills from the last inspection.
    """
    hive_labels = labels_df[labels_df["hive"] == hive_id]
    if hive_labels.empty:
        return None
    # Find the most recent inspection before or on this audio date
    prior = hive_labels[hive_labels["date"].dt.date <= audio_datetime.date()]
    if prior.empty:
        return None
    return float(prior.iloc[-1]["fob"])

def compute_modulation_tensorgram(signal, sr=SAMPLE_RATE):
    """
    Compute modulation tensorgram from audio signal.
    
    Based on the UrBAN paper:
    1. Short-term STFT: 100ms window, 12.5ms hop
    2. For each acoustic freq bin, compute modulation spectrum via second STFT
       using 60s window, no overlap
    3. Cap acoustic freq at 1000 Hz
    4. Bin merge: 20 acoustic bins × 40 modulation bins
    5. Keep time dimension → tensorgram (20×40×T)
    
    Returns numpy array of shape (20, 40, T) where T is number of 60s windows.
    """
    # Step 1: Short-term STFT
    n_fft_short = int(sr * STFT_WINDOW_MS / 1000)  # 1600 samples
    hop_short = int(sr * STFT_HOP_MS / 1000)       # 200 samples
    
    stft = librosa.stft(signal, n_fft=n_fft_short, hop_length=hop_short, 
                        window="hann", pad_mode="reflect")
    spectrogram = np.abs(stft) ** 2  # power spectrogram
    
    # Step 2: Cap at 1000 Hz
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft_short)
    freq_mask = freqs <= ACOUSTIC_FREQ_MAX
    spectrogram = spectrogram[freq_mask, :]  # (n_freq_bins_low, n_frames_short)
    
    # Step 3: For each acoustic freq bin, compute modulation spectrum
    # Second STFT across time dimension with 60s window
    frames_per_60s = int(MOD_WINDOW_S * sr / hop_short)  # frames in 60s
    
    if spectrogram.shape[1] < frames_per_60s:
        return None  # signal too short for one modulation window
    
    n_acoustic = spectrogram.shape[0]
    n_mod_windows = spectrogram.shape[1] // frames_per_60s
    
    # Truncate to complete windows
    spectrogram = spectrogram[:, :n_mod_windows * frames_per_60s]
    
    # Reshape into 60s chunks
    chunks = spectrogram.reshape(n_acoustic, n_mod_windows, frames_per_60s)
    
    # For each chunk and freq bin, compute FFT across time → modulation spectrum
    mod_fft = np.fft.rfft(chunks, axis=2)  # (n_acoustic, n_mod_windows, frames_per_60s//2+1)
    mod_spec = np.abs(mod_fft) ** 2
    
    # Step 4: Bin merging
    # Acoustic: n_acoustic → 20 bins
    acoustic_bins = np.array_split(np.arange(n_acoustic), N_ACOUSTIC_BINS)
    
    # Modulation: mod_spec.shape[2] → 40 bins
    n_mod_freqs = mod_spec.shape[2]
    mod_bins = np.array_split(np.arange(n_mod_freqs), N_MOD_BINS)
    
    # Aggregate
    tensorgram = np.zeros((N_ACOUSTIC_BINS, N_MOD_BINS, n_mod_windows))
    for i, ab in enumerate(acoustic_bins):
        for j, mb in enumerate(mod_bins):
            tensorgram[i, j, :] = mod_spec[ab, :, :][:, mb, :].mean(axis=(0, 2)) if len(mb) > 0 and len(ab) > 0 else 0
    
    # Actually fix the aggregation — mean over acoustic and modulation bins
    tensorgram = np.zeros((N_ACOUSTIC_BINS, N_MOD_BINS, n_mod_windows))
    for i, ab in enumerate(acoustic_bins):
        if len(ab) == 0:
            continue
        for j, mb in enumerate(mod_bins):
            if len(mb) == 0:
                continue
            # Mean over acoustic bins (ab) and modulation bins (mb)
            tensorgram[i, j, :] = mod_spec[ab, :, :][:, :, mb].mean(axis=(0, 2))
    
    # Normalize
    tensorgram = np.log10(tensorgram + 1e-10)
    
    return tensorgram  # (20, 40, n_mod_windows)

def parse_filename(filename):
    """
    Parse UrBAN audio filename: 'DD-MM-YYYY_HHhMM_HIVE-XXXX.wav'
    Returns (hive_id, datetime) or None.
    """
    try:
        # Example: 17-08-2021_09h15_HIVE-3628.wav
        base = os.path.basename(filename).replace(".wav", "")
        parts = base.split("_")
        date_str = parts[0]  # DD-MM-YYYY
        time_str = parts[1]  # HHhMM
        hive_str = parts[2]  # HIVE-XXXX
        
        day, month, year = date_str.split("-")
        hour, minute = time_str.replace("h", "").replace("M", "").split(":") if ":" in time_str else time_str.split("h")
        
        dt = datetime(int(year), int(month), int(day), int(hour), int(minute))
        hive_id = int(hive_str.replace("HIVE-", ""))
        return hive_id, dt
    except (IndexError, ValueError):
        return None, None

def process_tarball(tarball_path, labels_df, output_dir):
    """
    Extract a tar.gz, process all WAVs, save features, delete WAVs.
    """
    extract_dir = os.path.join(os.path.dirname(tarball_path), "extracted")
    os.makedirs(extract_dir, exist_ok=True)
    
    # Extract
    print(f"  Extracting {os.path.basename(tarball_path)}...")
    with tarfile.open(tarball_path, "r:gz") as tar:
        tar.extractall(extract_dir)
    
    # Find all WAVs
    wavs = glob.glob(os.path.join(extract_dir, "**", "*.wav"), recursive=True)
    print(f"  Found {len(wavs)} WAV files")
    
    features = []
    for i, wav_path in enumerate(wavs):
        hive_id, audio_dt = parse_filename(wav_path)
        if hive_id is None:
            continue
        
        fob = get_fob_for_audio(labels_df, hive_id, audio_dt)
        if fob is None:
            continue
        
        try:
            signal, sr = librosa.load(wav_path, sr=SAMPLE_RATE, mono=True)
        except Exception as e:
            print(f"    Error loading {os.path.basename(wav_path)}: {e}")
            continue
        
        tensorgram = compute_modulation_tensorgram(signal, sr)
        if tensorgram is None:
            continue
        
        # Flatten tensorgram for storage (we can reshape later for CNN)
        # Also compute 2D modulation spectrogram (time-averaged) for simpler models
        mod_spectrogram = tensorgram.mean(axis=2)  # (20, 40)
        
        features.append({
            "filename": os.path.basename(wav_path),
            "hive": hive_id,
            "datetime": audio_dt.isoformat(),
            "fob": fob,
            "mod_spectrogram": mod_spectrogram.flatten().tolist(),
            "tensorgram_shape": list(tensorgram.shape),
        })
        
        if (i + 1) % 100 == 0:
            print(f"    Processed {i+1}/{len(wavs)}...")
    
    # Save features for this tarball
    tarball_name = os.path.basename(tarball_path).replace(".tar.gz", "")
    out_file = os.path.join(output_dir, f"features_{tarball_name}.json")
    with open(out_file, "w") as f:
        json.dump(features, f)
    
    # Cleanup
    print(f"  Cleaning up WAVs...")
    for wav in wavs:
        try:
            os.remove(wav)
        except OSError:
            pass
    # Clean empty dirs
    for root, dirs, files in os.walk(extract_dir, topdown=False):
        for d in dirs:
            try:
                os.rmdir(os.path.join(root, d))
            except OSError:
                pass
    try:
        os.rmdir(extract_dir)
    except OSError:
        pass
    
    print(f"  Saved {len(features)} feature vectors to {out_file}")
    return len(features)

def discover_tarball_urls():
    """
    Try to discover downloadable tar.gz URLs from FRDR.
    FRDR uses Globus for large datasets but may have HTTP download links.
    """
    # FRDR dataset page
    # We'll need to check if there are direct HTTP links or if we need Globus
    # For now, return placeholder — we'll discover these from the browser
    pass

def main():
    parser = argparse.ArgumentParser(description="BeeTree audio → tensorgram pipeline")
    parser.add_argument("--download", action="store_true", help="Download from FRDR")
    parser.add_argument("--local-only", action="store_true", help="Process existing tar.gz files")
    parser.add_argument("--staging-dir", default=STAGING_DIR, help="Staging directory for raw audio")
    parser.add_argument("--output-dir", default=FEATURES_DIR, help="Output directory for features")
    args = parser.parse_args()
    
    os.makedirs(args.staging_dir, exist_ok=True)
    os.makedirs(args.output_dir, exist_ok=True)
    
    print("=== BeeTree Audio Pipeline ===")
    print(f"Staging: {args.staging_dir}")
    print(f"Features: {args.output_dir}")
    
    # Load labels
    print("\nLoading inspection labels...")
    labels_df = load_labels()
    print(f"  {len(labels_df)} label records across {labels_df['hive'].nunique()} hives")
    
    if args.download:
        print("\n--- Download mode ---")
        # For now, we need to discover the tarball URLs
        # This will be filled in once we inspect the FRDR download mechanism
        print("TODO: Discover tarball URLs from FRDR")
        print("The dataset uses Globus transfer. We may need to use globus CLI.")
        print("Alternative: Download via HTTP if FRDR provides direct links.")
        # discover_tarball_urls()
    
    if args.local_only:
        print("\n--- Local processing mode ---")
        tarballs = sorted(glob.glob(os.path.join(args.staging_dir, "**", "*.tar.gz"), recursive=True))
        print(f"Found {len(tarballs)} tar.gz files")
        
        total_features = 0
        for i, tb in enumerate(tarballs):
            print(f"\n[{i+1}/{len(tarballs)}] {os.path.basename(tb)}")
            n = process_tarball(tb, labels_df, args.output_dir)
            total_features += n
            
            # Delete the tarball after processing to save space
            try:
                os.remove(tb)
                print(f"  Deleted tarball")
            except OSError:
                pass
        
        print(f"\n=== Done. Total feature vectors: {total_features} ===")
    
    # Summary
    feature_files = glob.glob(os.path.join(args.output_dir, "features_*.json"))
    if feature_files:
        total = 0
        for f in feature_files:
            with open(f) as fh:
                data = json.load(fh)
                total += len(data)
        print(f"\nFeature dataset: {total} samples across {len(feature_files)} files")

if __name__ == "__main__":
    main()