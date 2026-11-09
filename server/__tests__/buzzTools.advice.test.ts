// Tests that the advice-loop tools are registered AND dispatch.
//
// The failure this guards against: a tool schema with no dispatcher case shows up
// in the model's prompt and then throws when called, so the model reports an
// error the beekeeper sees as BeeTree being broken. Registration and dispatch are
// two separate edits in buzzTools.ts and only a dispatch test catches the gap.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, genId } from '../db.js';
import { buzzToolSchemas, dispatchBuzzTool } from '../buzzTools.js';

// buzzToolSchemas is a heterogeneous array (ontology tools + buzz tools), so TS
// cannot narrow a lookup by name. The lookup is deliberately `any`.
function schema(name: string): any {
  return (buzzToolSchemas as any[]).find((s) => s.function.name === name)?.function;
}

function seedHive(hiveId: string): void {
  db.prepare(
    'INSERT INTO hives (id, entity_id, version, superseded_by, superseded_at, apiaryId, name, type, healthStatus, sensorIds, createdAt) ' +
    "VALUES (?, ?, 1, NULL, NULL, 'apiary-1', ?, 'langstroth', 'healthy', '[]', ?)",
  ).run(genId('hive'), hiveId, 'Hive Test', new Date().toISOString());
}

beforeEach(() => {
  db.exec('DELETE FROM advice_claim_grades');
  db.exec('DELETE FROM advice_claims');
  db.exec('DELETE FROM sensors');
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM hives');
  db.pragma('foreign_keys = ON');
});

describe('record_advice_claim tool', () => {
  it('is registered with the fields a gradable claim needs', () => {
    const s = schema('record_advice_claim');
    expect(s).toBeDefined();
    for (const field of ['claim', 'advice', 'metric', 'windowEnd']) {
      expect(s.parameters.required).toContain(field);
    }
    expect(s.parameters.properties.metric.enum).toContain('observation');
    expect(s.parameters.properties.predicate.enum).toEqual(
      expect.arrayContaining(['lt', 'gt', 'between', 'observed', 'absent']),
    );
  });

  it('stores a claim for a real hive and returns its id', async () => {
    seedHive('hive-tool-1');
    const windowEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const raw = await dispatchBuzzTool('record_advice_claim', {
      hiveId: 'hive-tool-1',
      advice: 'Check the ventilation this weekend.',
      claim: 'Temperature comes back under 95F within a week',
      metric: 'temperature',
      predicate: 'lt',
      threshold: 95,
      unit: 'F',
      windowEnd,
    });
    const out = JSON.parse(raw);
    expect(out.ok).toBe(true);
    expect(out.claimId).toMatch(/^claim-/);

    const row = db.prepare('SELECT hiveName, status, basis FROM advice_claims WHERE id = ?')
      .get(out.claimId) as any;
    expect(row.hiveName).toBe('Hive Test');
    expect(row.status).toBe('open');
    expect(row.basis).toBe('final');
  });

  it('returns a validation error instead of throwing, so the model can retry', async () => {
    seedHive('hive-tool-1');
    const raw = await dispatchBuzzTool('record_advice_claim', {
      hiveId: 'hive-tool-1',
      advice: 'Check the ventilation.',
      claim: 'Temperature comes back under 95F',
      metric: 'temperature',
      predicate: 'lt',
      // no threshold — ungradeable if accepted
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const out = JSON.parse(raw);
    expect(out.error).toMatch(/threshold/);
    const n = db.prepare('SELECT COUNT(*) AS n FROM advice_claims').get() as any;
    expect(n.n).toBe(0);
  });

  it('refuses a claim on a hive that does not exist', async () => {
    const raw = await dispatchBuzzTool('record_advice_claim', {
      hiveId: 'hive-nope',
      advice: 'a',
      claim: 'b',
      metric: 'observation',
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(JSON.parse(raw).error).toMatch(/unknown hiveId/);
  });
});

describe('get_advice_accuracy tool', () => {
  it('is registered', () => {
    expect(schema('get_advice_accuracy')).toBeDefined();
  });

  it('reports a zeroed summary with a calibration curve when nothing is graded', async () => {
    const out = JSON.parse(await dispatchBuzzTool('get_advice_accuracy', {}));
    expect(out.total).toBe(0);
    expect(out.accuracy).toBeNull();
    expect(out.calibration).toHaveLength(4);
  });
});
