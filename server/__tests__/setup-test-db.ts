// server/__tests__/setup-test-db.ts
//
// Isolation guard for the unit suite.
//
// Before this existed, `npm test` imported server/db.ts, which resolves its path
// to data/beetree.db — the beekeeper's live database — and then ran pending
// migrations against it. Two problems, both real:
//
//   1. A test run could apply schema changes to production data.
//   2. Vitest runs test files in parallel workers against the SAME file, so two
//      workers could both see a migration as pending and both try to apply it.
//      That is what produced "duplicate column name: file_path" from
//      010_media_files.sql — a race, not a bad migration.
//
// So: every worker gets its own throwaway database and media directory under the
// system temp dir, wiped at the start of each run so migrations always execute
// from a clean schema (which also means the suite exercises the migration path).
//
// This must run BEFORE any test file imports server/db.ts.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workerId = process.env.VITEST_WORKER_ID ?? '0';
const dir = join(tmpdir(), `beetree-test-${workerId}`);

mkdirSync(dir, { recursive: true });

// Start from nothing so migrations run for real on every invocation.
for (const f of ['beetree.db', 'beetree.db-wal', 'beetree.db-shm']) {
  rmSync(join(dir, f), { force: true });
}
rmSync(join(dir, 'media'), { recursive: true, force: true });

process.env.BEETREE_DB = join(dir, 'beetree.db');
process.env.BEETREE_MEDIA_DIR = join(dir, 'media');
