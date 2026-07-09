import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve DB path relative to project root (one level up from server/).
// Works regardless of the cwd the server is launched from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = resolve(__dirname, '..', 'data', 'beetree.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema — copy-on-write versioning
// ---------------------------------------------------------------------------
// Every table has:
//   id            TEXT — per-version unique row id (genId)
//   entity_id     TEXT — stable logical id (same across all versions)
//   version       INTEGER DEFAULT 1 — incrementing version number
//   superseded_by TEXT — NULL for current version; set to new row's id on supersede
//   superseded_at TEXT — timestamp when superseded
//
// Current version = WHERE entity_id = ? AND superseded_by IS NULL
// History        = WHERE entity_id = ? ORDER BY version DESC
// The `id` returned to the frontend is `entity_id` (stable).
// Foreign keys reference entity_id, not per-version row id.
// ---------------------------------------------------------------------------

export function initSchema(): void {
  db.exec(`
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
      superseded_at     TEXT,
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
      id        TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      superseded_at TEXT,
      hiveId    TEXT NOT NULL,
      type      TEXT NOT NULL,
      "index"   INTEGER NOT NULL,
      sensorIds TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_boxes_entity ON boxes(entity_id);
    CREATE INDEX IF NOT EXISTS idx_boxes_current ON boxes(entity_id) WHERE superseded_by IS NULL;
    CREATE INDEX IF NOT EXISTS idx_boxes_hive ON boxes(hiveId) WHERE superseded_by IS NULL;

    CREATE TABLE IF NOT EXISTS frame_slots (
      id        TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      superseded_at TEXT,
      boxId     TEXT NOT NULL,
      position  INTEGER NOT NULL,
      content   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fs_entity ON frame_slots(entity_id);
    CREATE INDEX IF NOT EXISTS idx_fs_current ON frame_slots(entity_id) WHERE superseded_by IS NULL;
    CREATE INDEX IF NOT EXISTS idx_fs_box ON frame_slots(boxId) WHERE superseded_by IS NULL;

    CREATE TABLE IF NOT EXISTS sensors (
      id        TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      superseded_at TEXT,
      deviceId  TEXT NOT NULL,
      name      TEXT NOT NULL,
      model     TEXT NOT NULL,
      hiveId    TEXT,
      boxId     TEXT,
      position  TEXT,
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
      id           TEXT PRIMARY KEY,
      entity_id    TEXT NOT NULL,
      version      INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      superseded_at TEXT,
      inspectionId TEXT NOT NULL,
      type         TEXT NOT NULL,
      count        INTEGER,
      note         TEXT
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
  `);
}

initSchema();

// ---------------------------------------------------------------------------
// Row mappers (DB rows -> app-shaped objects)
// ---------------------------------------------------------------------------
function bool(v: unknown): boolean {
  return v === 1 || v === true;
}

export interface ApiaryRow {
  id: string; entity_id: string; version: number; superseded_by: string | null; superseded_at: string | null;
  name: string; location_lat: number | null; location_lng: number | null;
  address: string | null; notes: string | null;
}

export function mapApiary(r: ApiaryRow) {
  return {
    id: r.entity_id,
    version: r.version,
    entityId: r.entity_id,
    name: r.name,
    location: r.location_lat != null && r.location_lng != null
      ? { lat: r.location_lat, lng: r.location_lng } : undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export interface HiveRow {
  id: string; entity_id: string; version: number; superseded_by: string | null; superseded_at: string | null;
  apiaryId: string; name: string; type: string; healthStatus: string;
  notes: string | null; createdAt: string;
  location_lat: number | null; location_lng: number | null; location_accuracy: number | null;
  location_pinnedAt: string | null; location_label: string | null;
  sensorIds: string;
}

export interface BoxRow {
  id: string; entity_id: string; version: number; superseded_by: string | null; superseded_at: string | null;
  hiveId: string; type: string; index: number; sensorIds: string;
}

export interface FrameSlotRow {
  id: string; entity_id: string; version: number; superseded_by: string | null; superseded_at: string | null;
  boxId: string; position: number; content: string;
}

export function mapHive(
  r: HiveRow,
  boxes: BoxRow[],
  frameSlots: FrameSlotRow[],
): any {
  const hiveEntityId = r.entity_id;
  return {
    id: hiveEntityId,
    version: r.version,
    entityId: hiveEntityId,
    apiaryId: r.apiaryId,
    name: r.name,
    type: r.type,
    healthStatus: r.healthStatus,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt,
    sensorIds: JSON.parse(r.sensorIds || '[]'),
    location: r.location_lat != null && r.location_lng != null
      ? {
          lat: r.location_lat,
          lng: r.location_lng,
          accuracy: r.location_accuracy ?? undefined,
          pinnedAt: r.location_pinnedAt ?? undefined,
          label: r.location_label ?? undefined,
        }
      : undefined,
    boxes: boxes
      .filter((b) => b.hiveId === hiveEntityId && !b.superseded_by)
      .sort((a, b) => a.index - b.index)
      .map((b) => ({
        id: b.entity_id,
        type: b.type,
        index: b.index,
        sensorIds: JSON.parse(b.sensorIds || '[]'),
        frames: frameSlots
          .filter((f) => f.boxId === b.entity_id && !f.superseded_by)
          .sort((a, b) => a.position - b.position)
          .map((f) => ({ position: f.position, content: f.content })),
      })),
  };
}

export interface InspectionRow {
  id: string; entity_id: string; version: number; superseded_by: string | null; superseded_at: string | null;
  hiveId: string; date: string;
  queenPresent: number; queenCells: number; queenLayingPattern: string;
  eggsPresent: number; larvaePresent: number; cappedBrood: number;
  temperament: string; honeyStores: string; pollenStores: string;
  populationSize: string; hiveWeight: number; healthStatus: string;
  healthAutoCalculated: number; colonyDead: number; notes: string; photoUrls: string;
}

export function mapInspection(r: InspectionRow, concerns: any[]) {
  return {
    id: r.entity_id,
    version: r.version,
    entityId: r.entity_id,
    hiveId: r.hiveId,
    date: r.date,
    queenPresent: bool(r.queenPresent),
    queenCells: bool(r.queenCells),
    queenLayingPattern: r.queenLayingPattern,
    eggsPresent: bool(r.eggsPresent),
    larvaePresent: bool(r.larvaePresent),
    cappedBrood: bool(r.cappedBrood),
    temperament: r.temperament,
    honeyStores: r.honeyStores,
    pollenStores: r.pollenStores,
    populationSize: r.populationSize,
    hiveWeight: r.hiveWeight,
    healthStatus: r.healthStatus,
    healthAutoCalculated: bool(r.healthAutoCalculated),
    colonyDead: bool(r.colonyDead),
    notes: r.notes,
    photoUrls: JSON.parse(r.photoUrls || '[]'),
    concerns: concerns.map((c: any) => ({
      id: c.entity_id ?? c.id,
      type: c.type,
      count: c.count != null ? c.count : undefined,
      note: c.note ?? undefined,
    })),
    media: [] as any[],
  };
}

export function mapSensor(r: any) {
  return {
    id: r.entity_id,
    version: r.version,
    entityId: r.entity_id,
    deviceId: r.deviceId,
    name: r.name,
    model: r.model,
    hiveId: r.hiveId ?? undefined,
    boxId: r.boxId ?? undefined,
    position: r.position ?? undefined,
    latestReading: r.latestReading ? JSON.parse(r.latestReading) : undefined,
  };
}

export function mapTask(r: any) {
  return {
    id: r.entity_id,
    version: r.version,
    entityId: r.entity_id,
    hiveId: r.hiveId ?? undefined,
    apiaryId: r.apiaryId ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    dueDate: r.dueDate ?? undefined,
    completed: bool(r.completed),
    priority: r.priority,
  };
}

export function mapMedia(r: any) {
  return {
    id: r.entity_id,
    version: r.version,
    entityId: r.entity_id,
    inspectionId: r.inspectionId ?? undefined,
    hiveId: r.hiveId ?? undefined,
    type: r.type,
    dataUrl: r.dataUrl,
    timestamp: r.timestamp,
    label: r.label ?? undefined,
    duration: r.duration ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Generate a unique row id (per-version) */
export function genId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Current ISO timestamp */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Copy-on-write: supersede the current version of an entity and insert a new version.
 * Returns the new row id.
 *
 * Usage: const newRowId = cowSupersede('apiaries', entityId, (oldRow) => {
 *   return { name: 'new name', ...otherFields };
 * });
 */
export function cowSupersede(
  table: string,
  entityId: string,
  buildNewRow: (oldRow: Record<string, any>) => Record<string, any>,
): string {
  const oldRow = db.prepare(
    `SELECT * FROM ${table} WHERE entity_id = ? AND superseded_by IS NULL`,
  ).get(entityId) as Record<string, any> | undefined;

  if (!oldRow) throw new Error(`Entity not found: ${table}/${entityId}`);

  const newRowId = genId('cow');
  const newVersion = (oldRow.version || 1) + 1;
  const ts = now();

  const newRowData = buildNewRow(oldRow);
  const insertCols = ['id', 'entity_id', 'version', 'superseded_by', 'superseded_at', ...Object.keys(newRowData)];
  const insertVals = [newRowId, entityId, newVersion, null, null, ...Object.values(newRowData)];

  const placeholders = insertCols.map(() => '?').join(', ');
  const colNames = insertCols.map((c) => `"${c}"`).join(', ');
  db.prepare(`INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`).run(...insertVals);

  db.prepare(
    `UPDATE ${table} SET superseded_by = ?, superseded_at = ? WHERE id = ?`,
  ).run(newRowId, ts, oldRow.id);

  return newRowId;
}
