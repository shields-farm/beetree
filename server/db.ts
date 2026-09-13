import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve DB path relative to project root (one level up from server/).
// Works regardless of the cwd the server is launched from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Overridable so the Playwright suite can run against a throwaway copy instead
// of the beekeeper's live database.
const DB_PATH = process.env.BEETREE_DB
  ? resolve(process.env.BEETREE_DB)
  : resolve(__dirname, '..', 'data', 'beetree.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Migrations — run before schema init
// ---------------------------------------------------------------------------
// The migration runner tracks applied migrations in a _migrations table
// and runs pending .sql/.ts files from server/migrations/ on every boot.
// This replaces the old inline initSchema() — schema changes now go in
// numbered migration files (001_initial_schema.sql, 002_add_xxx.sql, etc.)
// ---------------------------------------------------------------------------

import { runMigrations } from './migrate.js';
// Run migrations async — note: top-level await requires ESM, which we use (type: module)
await runMigrations();

// ---------------------------------------------------------------------------
// Schema — copy-on-write versioning
// ---------------------------------------------------------------------------
// Every table has:
//   id            TEXT — per-version unique row id (genId)
//   entity_id     TEXT — stable logical id (same across all versions)
//   version       INTEGER NOT NULL DEFAULT 1 — incrementing version number
//   superseded_by TEXT — NULL for current version; set to new row's id on supersede
//   superseded_at TEXT — timestamp when superseded
//
// Current version = WHERE entity_id = ? AND superseded_by IS NULL
// History        = WHERE entity_id = ? ORDER BY version DESC
// The `id` returned to the frontend is `entity_id` (stable).
// Foreign keys reference entity_id, not per-version row id.
// ---------------------------------------------------------------------------

// NOTE: Table creation is handled by migrations (server/migrations/*.sql).
// The initSchema() function is kept for backward compat but is now a no-op —
// migrations create all tables. New schema changes go in migration files.
export function initSchema(): void {
  // No-op — migrations handle schema creation and evolution.
  // Kept so index.ts doesn't need to change.
}

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
  content: string | null;
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
        // Box-level majority content, when classified.
        content: b.content ?? undefined,
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

  // Order matters: supersede the old row BEFORE inserting its successor.
  //
  // `hives` carries a unique index on entity_id for the current row
  // (WHERE superseded_by IS NULL). Inserting first collides with the row still
  // marked current and the whole update fails with "UNIQUE constraint failed:
  // hives.entity_id" — which is why hive edits returned HTTP 500 and why no row
  // in the entire database had ever moved past version 1.
  //
  // Both statements run in one transaction: a failure rolls back and leaves the
  // entity exactly as it was rather than mid-supersede.
  const supersede = db.transaction(() => {
    db.prepare(
      `UPDATE ${table} SET superseded_by = ?, superseded_at = ? WHERE id = ?`,
    ).run(newRowId, ts, oldRow.id);

    db.prepare(`INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`).run(...insertVals);
  });
  supersede();

  return newRowId;
}
