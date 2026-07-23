-- Migration 001: Initial schema with copy-on-write versioning
-- Every table has: id (per-version PK), entity_id (stable logical id),
-- version (incrementing), superseded_by (null=current), superseded_at (timestamp).
-- Current version = WHERE entity_id = ? AND superseded_by IS NULL
-- History = WHERE entity_id = ? ORDER BY version DESC

CREATE TABLE IF NOT EXISTS apiaries (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  name          TEXT NOT NULL,
  location_lat  REAL,
  location_lng  REAL,
  address       TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_apiaries_entity ON apiaries(entity_id);
CREATE INDEX IF NOT EXISTS idx_apiaries_current ON apiaries(entity_id) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS hives (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  superseded_by     TEXT,
  superseded_at    TEXT,
  apiaryId          TEXT NOT NULL,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  healthStatus      TEXT NOT NULL,
  notes             TEXT,
  createdAt         TEXT NOT NULL,
  location_lat      REAL,
  location_lng      REAL,
  location_accuracy REAL,
  location_pinnedAt TEXT,
  location_label    TEXT,
  sensorIds         TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_hives_entity ON hives(entity_id);
CREATE INDEX IF NOT EXISTS idx_hives_current ON hives(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_hives_apiary ON hives(apiaryId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS boxes (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  hiveId        TEXT NOT NULL,
  type          TEXT NOT NULL,
  "index"       INTEGER NOT NULL,
  sensorIds     TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_boxes_entity ON boxes(entity_id);
CREATE INDEX IF NOT EXISTS idx_boxes_current ON boxes(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_boxes_hive ON boxes(hiveId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS frame_slots (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  boxId         TEXT NOT NULL,
  position      INTEGER NOT NULL,
  content       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_entity ON frame_slots(entity_id);
CREATE INDEX IF NOT EXISTS idx_fs_current ON frame_slots(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_fs_box ON frame_slots(boxId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS sensors (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  deviceId      TEXT NOT NULL,
  name          TEXT NOT NULL,
  model         TEXT NOT NULL,
  hiveId        TEXT,
  boxId         TEXT,
  position      TEXT,
  latestReading TEXT
);
CREATE INDEX IF NOT EXISTS idx_sensors_entity ON sensors(entity_id);
CREATE INDEX IF NOT EXISTS idx_sensors_current ON sensors(entity_id) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS inspections (
  id                   TEXT PRIMARY KEY,
  entity_id            TEXT NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  superseded_by        TEXT,
  superseded_at        TEXT,
  hiveId               TEXT NOT NULL,
  date                 TEXT NOT NULL,
  queenPresent         INTEGER NOT NULL,
  queenCells           INTEGER NOT NULL,
  queenLayingPattern   TEXT NOT NULL,
  eggsPresent          INTEGER NOT NULL,
  larvaePresent        INTEGER NOT NULL,
  cappedBrood          INTEGER NOT NULL,
  temperament          TEXT NOT NULL,
  honeyStores          TEXT NOT NULL,
  pollenStores         TEXT NOT NULL,
  populationSize       TEXT NOT NULL,
  hiveWeight           REAL NOT NULL,
  healthStatus         TEXT NOT NULL,
  healthAutoCalculated INTEGER NOT NULL,
  colonyDead           INTEGER NOT NULL,
  notes                TEXT NOT NULL,
  photoUrls            TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_insp_entity ON inspections(entity_id);
CREATE INDEX IF NOT EXISTS idx_insp_current ON inspections(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_insp_hive ON inspections(hiveId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS concerns (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  inspectionId  TEXT NOT NULL,
  type          TEXT NOT NULL,
  count         INTEGER,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_concerns_entity ON concerns(entity_id);
CREATE INDEX IF NOT EXISTS idx_concerns_current ON concerns(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_concerns_insp ON concerns(inspectionId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS media_items (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  inspectionId  TEXT,
  hiveId        TEXT,
  type          TEXT NOT NULL,
  dataUrl       TEXT NOT NULL,
  timestamp     TEXT NOT NULL,
  label         TEXT,
  duration      REAL
);
CREATE INDEX IF NOT EXISTS idx_media_entity ON media_items(entity_id);
CREATE INDEX IF NOT EXISTS idx_media_current ON media_items(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_insp ON media_items(inspectionId) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_hive ON media_items(hiveId) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  hiveId        TEXT,
  apiaryId      TEXT,
  title         TEXT NOT NULL,
  description   TEXT,
  dueDate       TEXT,
  completed     INTEGER NOT NULL DEFAULT 0,
  priority      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_entity ON tasks(entity_id);
CREATE INDEX IF NOT EXISTS idx_tasks_current ON tasks(entity_id) WHERE superseded_by IS NULL;