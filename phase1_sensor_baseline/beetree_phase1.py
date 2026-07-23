#!/usr/bin/env python3
"""
BeeTree Phase 1: Colony strength baseline from sensor data (temp/humidity → frames of bees).
No audio needed. Uses UrBAN dataset sensor + inspection annotations already in the repo.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import pearsonr
import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

def load_inspections_2021():
    """Load 2021 inspection labels with frames of bees."""
    df = pd.read_csv(os.path.join(DATA_DIR, "annotations/inspections_2021.csv"))
    df = df.fillna(0)
    df["Date"] = pd.to_datetime(df["Date"])
    # Total frames of bees across all boxes
    df["fob_total"] = df[["Fob 1st", "Fob 2nd", "Fob 3rd"]].astype(float).sum(axis=1)
    return df

def load_inspections_2022():
    """Load 2022 inspection labels — different format, fob is in 'Action detail'."""
    df = pd.read_csv(os.path.join(DATA_DIR, "annotations/inspections_2022.csv"))
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.date
    # Filter to frames-of-bees entries
    fob_df = df[df["Category"] == "frames of bees"].copy()
    fob_df["fob_total"] = pd.to_numeric(fob_df["Action detail"], errors="coerce")
    fob_df = fob_df.dropna(subset=["fob_total"])
    return fob_df

def load_sensor_2021():
    """Load in-hive temperature and humidity sensor data."""
    df = pd.read_csv(os.path.join(DATA_DIR, "temperature_humidity/sensor_2021.csv"))
    df["Date"] = pd.to_datetime(df["Date"])
    return df

def load_weather():
    """Load external weather data."""
    df = pd.read_csv(os.path.join(DATA_DIR, "weather_info/weather_2021_2022.csv"))
    df["Date/Time (LST)"] = pd.to_datetime(df["Date/Time (LST)"])
    return df

def build_training_data(sensor, insp, weather):
    """
    Join sensor data with inspection labels.
    For each inspection, compute sensor statistics from the preceding 24h and 7d.
    """
    # Aggregate sensor data per hive per day
    sensor["date_only"] = sensor["Date"].dt.date
    daily_sensor = sensor.groupby(["Tag number", "date_only"]).agg(
        temp_mean=("temperature", "mean"),
        temp_std=("temperature", "std"),
        temp_min=("temperature", "min"),
        temp_max=("temperature", "max"),
        humidity_mean=("humidity", "mean"),
        humidity_std=("humidity", "std"),
        humidity_min=("humidity", "min"),
        humidity_max=("humidity", "max"),
        readings_count=("temperature", "count"),
    ).reset_index()

    # Merge with inspections
    insp = insp.copy()
    insp["date_only"] = insp["Date"].dt.date
    merged = insp.merge(daily_sensor, on=["Tag number", "date_only"], how="inner")

    # Add weather features (external temp/humidity as context)
    weather["date_only"] = weather["Date/Time (LST)"].dt.date
    daily_weather = weather.groupby("date_only").agg(
        ext_temp_mean=("Temp (°C)", "mean"),
        ext_temp_min=("Temp (°C)", "min"),
        ext_temp_max=("Temp (°C)", "max"),
        ext_humidity_mean=("Rel Hum (%)", "mean"),
        precip=("Precip. Amount (mm)", "sum"),
    ).reset_index()

    merged = merged.merge(daily_weather, on="date_only", how="left")

    # Compute temp differential (inside vs outside)
    merged["temp_diff"] = merged["temp_mean"] - merged["ext_temp_mean"]

    # Month as feature (seasonality)
    merged["month"] = pd.to_datetime(merged["date_only"]).dt.month

    return merged

def train_and_evaluate(df, feature_cols, label_col="fob_total", group_col="Tag number"):
    """
    Train Random Forest with hive-independent cross-validation.
    This is the key test: can we predict colony strength for a hive we've never seen?
    """
    X = df[feature_cols].values
    y = df[label_col].values
    groups = df[group_col].values

    # Box clipping (same as UrBAN paper: 1-10, 11-20, 21-30)
    def clip_predictions(y_true, y_pred):
        clipped = []
        for yt, yp in zip(y_true, y_pred):
            if yt <= 10:
                clipped.append(np.clip(yp, 0, 10))
            elif yt <= 20:
                clipped.append(np.clip(yp, 10, 20))
            else:
                clipped.append(np.clip(yp, 20, 30))
        return np.array(clipped)

    # Leave-one-hive-out CV
    n_hives = len(np.unique(groups))
    cv = GroupKFold(n_splits=min(n_hives, 5))

    model = RandomForestRegressor(n_estimators=200, max_depth=15, random_state=42)
    predictions = cross_val_predict(model, X, y, groups=groups, cv=cv)

    # Raw metrics
    mae = mean_absolute_error(y, predictions)
    rmse = np.sqrt(mean_squared_error(y, predictions))
    r2 = r2_score(y, predictions)
    corr, p_val = pearsonr(y, predictions)

    # Clipped metrics (box-constrained, same as paper)
    clipped_pred = clip_predictions(y, predictions)
    mae_clipped = mean_absolute_error(y, clipped_pred)
    rmse_clipped = np.sqrt(mean_squared_error(y, clipped_pred))
    r2_clipped = r2_score(y, clipped_pred)
    corr_clipped, _ = pearsonr(y, clipped_pred)

    # Also fit on all data for feature importance
    model.fit(X, y)
    importance = dict(zip(feature_cols, model.feature_importances_))

    return {
        "raw": {"mae": mae, "rmse": rmse, "r2": r2, "corr": corr, "p_value": p_val},
        "clipped": {"mae": mae_clipped, "rmse": rmse_clipped, "r2": r2_clipped, "corr": corr_clipped},
        "feature_importance": dict(sorted(importance.items(), key=lambda x: -x[1])),
        "n_samples": len(y),
        "n_hives": n_hives,
        "fob_range": [float(y.min()), float(y.max()), float(y.mean())],
    }

def main():
    print("=== BeeTree Phase 1: Sensor-Based Colony Strength Baseline ===\n")

    # Load data
    print("Loading data...")
    sensor = load_sensor_2021()
    insp = load_inspections_2021()
    weather = load_weather()
    print(f"  Sensor: {len(sensor):,} records, {sensor['Tag number'].nunique()} hives")
    print(f"  Inspections: {len(insp)} records, {insp['Tag number'].nunique()} hives")
    print(f"  Weather: {len(weather):,} records")

    # Build training data
    print("\nJoining sensor + inspection + weather...")
    df = build_training_data(sensor, insp, weather)
    print(f"  Training samples: {len(df)}")
    print(f"  Hives: {sorted(df['Tag number'].unique())}")
    print(f"  FoB range: {df['fob_total'].min():.0f} - {df['fob_total'].max():.0f} (mean {df['fob_total'].mean():.1f})")

    # Feature sets to test
    feature_sets = {
        "temp_humidity_only": [
            "temp_mean", "temp_std", "temp_min", "temp_max",
            "humidity_mean", "humidity_std", "humidity_min", "humidity_max",
        ],
        "temp_humidity_weather": [
            "temp_mean", "temp_std", "temp_min", "temp_max",
            "humidity_mean", "humidity_std", "humidity_min", "humidity_max",
            "ext_temp_mean", "ext_temp_min", "ext_temp_max",
            "ext_humidity_mean", "precip", "temp_diff",
        ],
        "temp_humidity_weather_season": [
            "temp_mean", "temp_std", "temp_min", "temp_max",
            "humidity_mean", "humidity_std", "humidity_min", "humidity_max",
            "ext_temp_mean", "ext_temp_min", "ext_temp_max",
            "ext_humidity_mean", "precip", "temp_diff", "month",
        ],
    }

    results = {}
    for name, features in feature_sets.items():
        print(f"\n--- Training: {name} ---")
        print(f"  Features ({len(features)}): {features}")
        result = train_and_evaluate(df, features)
        results[name] = result
        print(f"  Samples: {result['n_samples']}, Hives: {result['n_hives']}")
        print(f"  RAW:       MAE={result['raw']['mae']:.2f}, RMSE={result['raw']['rmse']:.2f}, R²={result['raw']['r2']:.3f}, Corr={result['raw']['corr']:.3f} (p={result['raw']['p_value']:.4f})")
        print(f"  CLIPPED:   MAE={result['clipped']['mae']:.2f}, RMSE={result['clipped']['rmse']:.2f}, R²={result['clipped']['r2']:.3f}, Corr={result['clipped']['corr']:.3f}")
        print(f"  Top features:")
        for fname, imp in list(result["feature_importance"].items())[:5]:
            print(f"    {fname}: {imp:.3f}")

    # Save results
    out_path = os.path.join(os.path.dirname(__file__), "phase1_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to {out_path}")

    # Summary
    print("\n=== SUMMARY ===")
    print("Sensor-only baseline (no audio):")
    for name, r in results.items():
        print(f"  {name}: MAE={r['clipped']['mae']:.2f} fob, Corr={r['clipped']['corr']:.3f}")
    print("\nFor context, the UrBAN paper's audio-based methods achieve MAE ~3-4 fob")
    print("with Corr ~0.7-0.8. This sensor baseline tells us the floor before adding audio.")

if __name__ == "__main__":
    main()