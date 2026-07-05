import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Resolve DB path relative to project root (one level up from server/)
const DB_PATH = resolve(process.cwd(), 'data', 'beetree.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apiaries (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      location_lat  REAL,
      location_lng  REAL,
      address       TEXT,
      notes         TEXT
    );

    CREATE TABLE IF NOT EXISTS hives (
      id                TEXT PRIMARY KEY,
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
      sensorIds         TEXT DEFAULT '[]',
      FOREIGN KEY (apiaryId) REFERENCES apiaries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS boxes (
      id      TEXT PRIMARY KEY,
      hiveId  TEXT NOT NULL,
      type    TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      sensorIds TEXT DEFAULT '[]',
      FOREIGN KEY (hiveId) REFERENCES hives(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS frame_slots (
      id      TEXT PRIMARY KEY,
      boxId   TEXT NOT NULL,
      position INTEGER NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (boxId) REFERENCES boxes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sensors (
      id        TEXT PRIMARY KEY,
      deviceId  TEXT NOT NULL,
      name      TEXT NOT NULL,
      model     TEXT NOT NULL,
      hiveId    TEXT,
      boxId     TEXT,
      position  TEXT,
      latestReading TEXT,
      FOREIGN KEY (hiveId) REFERENCES hives(id) ON DELETE SET NULL,
      FOREIGN KEY (boxId)  REFERENCES boxes(id)  ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inspections (
      id                   TEXT PRIMARY KEY,
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
      photoUrls            TEXT DEFAULT '[]',
      FOREIGN KEY (hiveId) REFERENCES hives(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS concerns (
      id            TEXT PRIMARY KEY,
      inspectionId  TEXT NOT NULL,
      type          TEXT NOT NULL,
      count         INTEGER,
      note          TEXT,
      FOREIGN KEY (inspectionId) REFERENCES inspections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id            TEXT PRIMARY KEY,
      inspectionId  TEXT,
      hiveId        TEXT,
      type          TEXT NOT NULL,
      dataUrl       TEXT NOT NULL,
      timestamp     TEXT NOT NULL,
      label         TEXT,
      duration      REAL,
      FOREIGN KEY (inspectionId) REFERENCES inspections(id) ON DELETE CASCADE,
      FOREIGN KEY (hiveId)        REFERENCES hives(id)        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      hiveId      TEXT,
      apiaryId    TEXT,
      title       TEXT NOT NULL,
      description TEXT,
      dueDate     TEXT,
      completed   INTEGER NOT NULL DEFAULT 0,
      priority    TEXT NOT NULL,
      FOREIGN KEY (hiveId)   REFERENCES hives(id)   ON DELETE CASCADE,
      FOREIGN KEY (apiaryId) REFERENCES apiaries(id) ON DELETE CASCADE
    );
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
  id: string; name: string; location_lat: number | null; location_lng: number | null;
  address: string | null; notes: string | null;
}

export function mapApiary(r: ApiaryRow) {
  return {
    id: r.id,
    name: r.name,
    location: r.location_lat != null && r.location_lng != null
      ? { lat: r.location_lat, lng: r.location_lng } : undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export interface HiveRow {
  id: string; apiaryId: string; name: string; type: string; healthStatus: string;
  notes: string | null; createdAt: string;
  location_lat: number | null; location_lng: number | null; location_accuracy: number | null;
  location_pinnedAt: string | null; location_label: string | null;
  sensorIds: string;
}

export interface BoxRow {
  id: string; hiveId: string; type: string; index: number; sensorIds: string;
}

export interface FrameSlotRow {
  id: string; boxId: string; position: number; content: string;
}

export function mapHive(
  r: HiveRow,
  boxes: BoxRow[],
  frameSlots: FrameSlotRow[],
): any {
  return {
    id: r.id,
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
      .filter((b) => b.hiveId === r.id)
      .sort((a, b) => a.index - b.index)
      .map((b) => ({
        id: b.id,
        type: b.type,
        index: b.index,
        sensorIds: JSON.parse(b.sensorIds || '[]'),
        frames: frameSlots
          .filter((f) => f.boxId === b.id)
          .sort((a, b) => a.position - b.position)
          .map((f) => ({ position: f.position, content: f.content })),
      })),
  };
}

export interface InspectionRow {
  id: string; hiveId: string; date: string;
  queenPresent: number; queenCells: number; queenLayingPattern: string;
  eggsPresent: number; larvaePresent: number; cappedBrood: number;
  temperament: string; honeyStores: string; pollenStores: string;
  populationSize: string; hiveWeight: number; healthStatus: string;
  healthAutoCalculated: number; colonyDead: number; notes: string; photoUrls: string;
}

export function mapInspection(r: InspectionRow, concerns: any[]) {
  return {
    id: r.id,
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
    concerns,
    media: [] as any[],
  };
}

export function mapSensor(r: any) {
  return {
    id: r.id,
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
    id: r.id,
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
    id: r.id,
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
export function genId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}