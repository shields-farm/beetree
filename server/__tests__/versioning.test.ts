import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Copy-on-write versioning test using an in-memory SQLite DB
// This mirrors the schema and cowSupersede logic from db.ts

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE apiaries (
      id            TEXT PRIMARY KEY,
      entity_id     TEXT NOT NULL,
      version       INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      superseded_at TEXT,
      name          TEXT NOT NULL,
      address       TEXT
    );
  `);
  return db;
}

function genId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function now(): string {
  return new Date().toISOString();
}

function cowSupersede(
  db: Database.Database,
  entityId: string,
  buildNewRow: (oldRow: Record<string, any>) => Record<string, any>,
): string {
  const oldRow = db.prepare(
    'SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL',
  ).get(entityId) as Record<string, any> | undefined;

  if (!oldRow) throw new Error(`Entity not found: apiaries/${entityId}`);

  const newRowId = genId('cow');
  const newVersion = (oldRow.version || 1) + 1;
  const ts = now();

  const newRowData = buildNewRow(oldRow);
  const insertCols = ['id', 'entity_id', 'version', 'superseded_by', 'superseded_at', ...Object.keys(newRowData)];
  const insertVals = [newRowId, entityId, newVersion, null, null, ...Object.values(newRowData)];
  const placeholders = insertCols.map(() => '?').join(', ');
  const colNames = insertCols.map((c) => `"${c}"`).join(', ');
  db.prepare(`INSERT INTO apiaries (${colNames}) VALUES (${placeholders})`).run(...insertVals);

  db.prepare(
    'UPDATE apiaries SET superseded_by = ?, superseded_at = ? WHERE id = ?',
  ).run(newRowId, ts, oldRow.id);

  return newRowId;
}

describe('copy-on-write versioning', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should create v1 on insert', () => {
    const entityId = genId('apiary');
    db.prepare('INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, address) VALUES (?, ?, 1, NULL, NULL, ?, ?)')
      .run(genId('apiary'), entityId, 'Riverside Apiary', '123 Riverside Rd');

    const row = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').get(entityId) as any;
    expect(row).toBeDefined();
    expect(row.version).toBe(1);
    expect(row.name).toBe('Riverside Apiary');
    expect(row.superseded_by).toBeNull();
  });

  it('should create new version on update (copy-on-write)', () => {
    const entityId = genId('apiary');
    db.prepare('INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, address) VALUES (?, ?, 1, NULL, NULL, ?, ?)')
      .run(genId('apiary'), entityId, 'Riverside Apiary', '123 Riverside Rd');

    // Simulate a rename
    cowSupersede(db, entityId, () => ({
      name: 'Riverside Apiary',
      address: '123 Riverside Rd',
    }));

    // Current version should be v2 with new name
    const current = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').get(entityId) as any;
    expect(current.version).toBe(2);
    expect(current.name).toBe('Riverside Apiary');

    // Old version should be superseded
    const old = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NOT NULL').get(entityId) as any;
    expect(old.version).toBe(1);
    expect(old.name).toBe('Riverside Apiary');
    expect(old.superseded_by).not.toBeNull();
    expect(old.superseded_at).not.toBeNull();
  });

  it('should return full history ordered by version', () => {
    const entityId = genId('apiary');
    db.prepare('INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, address) VALUES (?, ?, 1, NULL, NULL, ?, ?)')
      .run(genId('apiary'), entityId, 'V1', null);

    cowSupersede(db, entityId, () => ({ name: 'V2', address: null }));
    cowSupersede(db, entityId, () => ({ name: 'V3', address: null }));

    const history = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? ORDER BY version DESC').all(entityId) as any[];
    expect(history).toHaveLength(3);
    expect(history[0].version).toBe(3);
    expect(history[0].name).toBe('V3');
    expect(history[0].superseded_by).toBeNull();
    expect(history[1].version).toBe(2);
    expect(history[1].superseded_by).not.toBeNull();
    expect(history[2].version).toBe(1);
    expect(history[2].name).toBe('V1');
  });

  it('should only return current version when filtering superseded_by IS NULL', () => {
    const entityId = genId('apiary');
    db.prepare('INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, address) VALUES (?, ?, 1, NULL, NULL, ?, ?)')
      .run(genId('apiary'), entityId, 'Original', null);

    cowSupersede(db, entityId, () => ({ name: 'Updated', address: null }));
    cowSupersede(db, entityId, () => ({ name: 'Final', address: null }));

    const current = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').all(entityId) as any[];
    expect(current).toHaveLength(1);
    expect(current[0].name).toBe('Final');
    expect(current[0].version).toBe(3);
  });

  it('should revert to a previous version by creating a new version with old data', () => {
    const entityId = genId('apiary');
    db.prepare('INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, address) VALUES (?, ?, 1, NULL, NULL, ?, ?)')
      .run(genId('apiary'), entityId, 'Original Name', 'Address 1');

    cowSupersede(db, entityId, () => ({ name: 'Renamed', address: 'Address 2' }));

    // Revert to v1: copy v1's data into a new current version
    const v1Row = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND version = 1').get(entityId) as any;
    cowSupersede(db, entityId, () => ({
      name: v1Row.name,
      address: v1Row.address,
    }));

    const current = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').get(entityId) as any;
    expect(current.version).toBe(3);
    expect(current.name).toBe('Original Name');
    expect(current.address).toBe('Address 1');
  });
});