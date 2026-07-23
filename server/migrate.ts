import { db } from './db.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

/**
 * Migration runner — tracks applied migrations in a `_migrations` table,
 * runs pending migrations in order on every boot. Idempotent: skips
 * already-applied migrations.
 *
 * Each migration is a .sql file in server/migrations/ named like:
 *   001_initial_schema.sql
 *   002_add_versioning.sql
 *
 * For TypeScript migrations (.ts), use the pattern:
 *   003_add_forage.ts — exports `export function up(db: Database) { ... }`
 *
 * Down migrations are best-effort in SQLite (limited ALTER TABLE support).
 * For destructive changes, use the create-new-table → copy → drop → rename pattern.
 */

function ensureMigrationsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      applied_at  TEXT NOT NULL
    );
  `);
}

function getAppliedMigrations(): Set<string> {
  const rows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function recordMigration(name: string): void {
  db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
}

function runSqlMigration(filePath: string, name: string): void {
  const sql = readFileSync(filePath, 'utf-8');
  // Execute as a transaction — all or nothing
  db.exec('BEGIN');
  try {
    db.exec(sql);
    recordMigration(name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

async function runTsMigration(filePath: string, name: string): Promise<void> {
  // Dynamic import for .ts migrations (tsx handles this at runtime)
  const mod = await import(filePath);
  if (typeof mod.up !== 'function') {
    throw new Error(`Migration ${name} has no up() function`);
  }
  db.exec('BEGIN');
  try {
    mod.up(db);
    recordMigration(name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Run all pending migrations. Called on boot before initSchema().
 * If no migrations dir exists yet, this is a no-op.
 */
export async function runMigrations(): Promise<void> {
  ensureMigrationsTable();

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
      .sort(); // alphabetical = numeric prefix ordering
  } catch {
    // No migrations directory — nothing to run
    return;
  }

  const applied = getAppliedMigrations();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrations] All migrations up to date.');
    return;
  }

  for (const file of pending) {
    const filePath = join(MIGRATIONS_DIR, file);
    console.log(`[migrations] Running ${file}...`);
    try {
      if (file.endsWith('.sql')) {
        runSqlMigration(filePath, file);
      } else if (file.endsWith('.ts')) {
        await runTsMigration(filePath, file);
      }
      console.log(`[migrations] ✓ ${file}`);
    } catch (err) {
      console.error(`[migrations] ✗ ${file} failed:`, err);
      throw err; // halt boot — don't run with inconsistent schema
    }
  }
}

/**
 * List all migrations and their status (applied or pending).
 * Useful for a /api/migrations status endpoint.
 */
export function listMigrations(): { name: string; applied: boolean; appliedAt: string | null }[] {
  ensureMigrationsTable();
  const applied = getAppliedMigrations();
  const records = db.prepare('SELECT name, applied_at FROM _migrations').all() as MigrationRecord[];
  const appliedMap = new Map(records.map((r) => [r.name, r.applied_at]));

  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
      .sort();
  } catch { /* no dir */ }

  return files.map((f) => ({
    name: f,
    applied: applied.has(f),
    appliedAt: appliedMap.get(f) ?? null,
  }));
}