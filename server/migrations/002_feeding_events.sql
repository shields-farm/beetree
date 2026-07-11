-- Migration: Add feeding_events table for tracking syrup/fondant feedings
-- Tracks Apimaye feeder fills, Mountain Camp, entrance feeder, etc.
-- Includes refill calibration: logging how much was left when refilled
-- lets the consumption model self-correct per hive.

CREATE TABLE IF NOT EXISTS feeding_events (
  id              TEXT PRIMARY KEY,
  hiveId          TEXT NOT NULL,
  date            TEXT NOT NULL,
  feedType        TEXT NOT NULL,          -- 'syrup-1:1', 'syrup-2:1', 'fondant', 'dry-sugar', 'patty', 'pollen-patty'
  amount          REAL NOT NULL,           -- amount added in mL (for syrup) or grams (for solid)
  feederType      TEXT NOT NULL DEFAULT 'apimaye-inner-cover',
  note            TEXT DEFAULT '',

  -- Refill calibration: when this event is a refill, record what was found
  -- in the feeder before adding more. This lets us measure actual consumption
  -- vs. estimated and calibrate the model over time.
  refillState     TEXT DEFAULT NULL,      -- NULL = initial fill, 'empty' = feeder was empty, 'partial' = some left, 'full' = untouched
  remainingAmount REAL DEFAULT NULL,      -- mL or grams remaining when refilled (for 'partial')
  daysSinceFill   INTEGER DEFAULT NULL,   -- days since the previous feeding event (auto-computed)

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hiveId) REFERENCES hives(entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feeding_hive ON feeding_events(hiveId);
CREATE INDEX IF NOT EXISTS idx_feeding_date ON feeding_events(date);