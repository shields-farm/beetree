// server/queenTracking.ts — Queen ID tracking & supersedure detection

import { db, genId } from './db.js';

// ---------------------------------------------------------------------------
// Schema: queen_records table (created on module load)
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS queen_records (
    id          TEXT PRIMARY KEY,
    hiveId      TEXT NOT NULL,
    date        TEXT NOT NULL,
    queenColor  TEXT NOT NULL,
    queenYear   INTEGER NOT NULL,
    imageUrls   TEXT DEFAULT '[]',
    notes       TEXT DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'marked',
    FOREIGN KEY (hiveId) REFERENCES hives(id) ON DELETE CASCADE
  );
`);

export interface QueenRecord {
  id: string;
  hiveId: string;
  date: string;
  queenColor: string; // marking color
  queenYear: number; // year introduced
  imageUrls: string[];
  notes: string;
  source: 'marked' | 'detected' | 'supersedure-suspected';
}

export interface QueenStatus {
  hiveId: string;
  hiveName: string;
  currentQueen: QueenRecord | null;
  history: QueenRecord[];
  supersedureSuspected: boolean;
  daysSinceLastSeen: number | null;
  notes: string;
}

interface QueenRecordRow {
  id: string;
  hiveId: string;
  date: string;
  queenColor: string;
  queenYear: number;
  imageUrls: string;
  notes: string;
  source: string;
}

interface HiveNameRow {
  id: string;
  name: string;
}

function mapQueenRecord(r: QueenRecordRow): QueenRecord {
  const validSources = ['marked', 'detected', 'supersedure-suspected'];
  const source = validSources.includes(r.source) ? (r.source as QueenRecord['source']) : 'marked';
  return {
    id: r.id,
    hiveId: r.hiveId,
    date: r.date,
    queenColor: r.queenColor,
    queenYear: r.queenYear,
    imageUrls: JSON.parse(r.imageUrls || '[]'),
    notes: r.notes ?? '',
    source,
  };
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Build the QueenStatus for a single hive from its queen_records history.
 * Supersedure is suspected if the most recent record has a different
 * color/year than the previous record, OR if the most recent record's
 * source is "supersedure-suspected".
 */
function buildStatus(hiveId: string, hiveName: string, records: QueenRecord[]): QueenStatus {
  // Sort newest first
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const currentQueen = sorted[0] ?? null;

  let supersedureSuspected = false;
  let notes = '';

  if (currentQueen && currentQueen.source === 'supersedure-suspected') {
    supersedureSuspected = true;
    notes = 'Most recent record flagged as supersedure-suspected.';
  }

  if (sorted.length >= 2) {
    const prev = sorted[1];
    const curr = sorted[0];
    if (curr.queenColor !== prev.queenColor || curr.queenYear !== prev.queenYear) {
      supersedureSuspected = true;
      notes = 'Queen color or year changed between the two most recent sightings — possible supersedure.';
    }
  }

  const daysSinceLastSeen = currentQueen ? daysSince(currentQueen.date) : null;

  return {
    hiveId,
    hiveName,
    currentQueen,
    history: sorted,
    supersedureSuspected,
    daysSinceLastSeen,
    notes,
  };
}

/**
 * Get the QueenStatus for a single hive.
 */
export function getQueenStatus(hiveId: string): QueenStatus | null {
  const hiveRow = db.prepare('SELECT entity_id AS id, name FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId) as HiveNameRow | undefined;
  if (!hiveRow) return null;

  const rows = db.prepare('SELECT * FROM queen_records WHERE hiveId = ? ORDER BY date DESC').all(hiveId) as QueenRecordRow[];
  const records = rows.map(mapQueenRecord);
  return buildStatus(hiveId, hiveRow.name, records);
}

/**
 * Get QueenStatus for all hives (even those with no queen records).
 */
export function getAllQueenStatuses(): QueenStatus[] {
  const hives = db.prepare('SELECT entity_id AS id, name FROM hives WHERE superseded_by IS NULL ORDER BY name').all() as HiveNameRow[];
  const allRecords = db.prepare('SELECT * FROM queen_records').all() as QueenRecordRow[];

  const byHive = new Map<string, QueenRecord[]>();
  for (const r of allRecords) {
    const rec = mapQueenRecord(r);
    const arr = byHive.get(r.hiveId) ?? [];
    arr.push(rec);
    byHive.set(r.hiveId, arr);
  }

  return hives.map((h) => buildStatus(h.id, h.name, byHive.get(h.id) ?? []));
}

/**
 * Create a new queen record.
 */
export function recordQueen(params: {
  hiveId: string;
  queenColor: string;
  queenYear: number;
  imageUrls?: string[];
  notes?: string;
  source?: QueenRecord['source'];
}): QueenRecord {
  const { hiveId, queenColor, queenYear, imageUrls, notes, source } = params;
  const id = genId('qr');
  const date = new Date().toISOString();
  const validSources = ['marked', 'detected', 'supersedure-suspected'];
  const src = source && validSources.includes(source) ? source : 'marked';

  db.prepare(
    'INSERT INTO queen_records (id, hiveId, date, queenColor, queenYear, imageUrls, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    hiveId,
    date,
    queenColor,
    queenYear,
    JSON.stringify(imageUrls ?? []),
    notes ?? '',
    src,
  );

  const row = db.prepare('SELECT * FROM queen_records WHERE id = ?').get(id) as QueenRecordRow;
  return mapQueenRecord(row);
}

/**
 * International queen marking color chart by year.
 * Years ending in: 0/5 → Blue, 1/6 → White, 2/7 → Yellow, 3/8 → Red, 4/9 → Green
 */
export function queenColorForYear(year: number): string {
  const digit = year % 10;
  switch (digit) {
    case 0:
    case 5:
      return 'blue';
    case 1:
    case 6:
      return 'white';
    case 2:
    case 7:
      return 'yellow';
    case 3:
    case 8:
      return 'red';
    case 4:
    case 9:
      return 'green';
    default:
      return 'unknown';
  }
}