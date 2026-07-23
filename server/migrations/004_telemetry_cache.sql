-- Telemetry cache — stores InfluxDB time-series points in SQLite
-- so we don't round-trip to the HA Pi on every request.
--
-- Schema mirrors TimeSeriesPoint: one row per (deviceId, timestamp).
-- Composite UNIQUE on (deviceId, time) enables upsert via INSERT OR REPLACE.

CREATE TABLE IF NOT EXISTS telemetry_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId        TEXT NOT NULL,
  time            TEXT NOT NULL,
  temperature     REAL,
  humidity        REAL,
  batteryVoltage  REAL,
  signal          REAL,
  cachedAt        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(deviceId, time)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry_cache(deviceId);
CREATE INDEX IF NOT EXISTS idx_telemetry_time ON telemetry_cache(time);