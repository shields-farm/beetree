// Tests for the advice-claim ledger and the deterministic grader path.
//
// The invariant these protect: the accuracy number BeeTree shows a beekeeper
// must not be flattering. A claim the sensors could not see is 'unverifiable',
// never 'refuted'; a re-grade must not double-count a claim; and a numeric claim
// whose threshold was never supplied must be rejected at write time instead of
// sitting in the ledger as permanently ungradeable.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, genId } from '../db.js';
import {
  createClaim, getClaim, listClaims, dueClaims, recordGrade, voidClaim,
  validateClaim, accuracySummary, ClaimValidationError,
  type CreateClaimInput,
} from '../adviceClaims.js';
import { gradeNumeric, parseVerdicts } from '../adviceGrader.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** A hive with one bound sensor, so telemetry resolution has something to find. */
function seedHive(hiveId: string, deviceId: string): void {
  db.prepare(
    'INSERT INTO hives (id, entity_id, version, superseded_by, superseded_at, apiaryId, name, type, healthStatus, sensorIds, createdAt) ' +
    "VALUES (?, ?, 1, NULL, NULL, 'apiary-1', ?, 'langstroth', 'healthy', ?, ?)",
  ).run(genId('hive'), hiveId, `Hive ${hiveId}`, JSON.stringify([deviceId]), iso(0));

  db.prepare(
    'INSERT INTO sensors (id, entity_id, version, superseded_by, superseded_at, deviceId, name, model, hiveId) ' +
    "VALUES (?, ?, 1, NULL, NULL, ?, ?, 'TH', ?)",
  ).run(genId('sensor'), genId('sensor'), deviceId, `TH ${deviceId}`, hiveId);
}

/** Write a run of telemetry readings at a fixed cadence. */
function seedTelemetry(deviceId: string, startMs: number, count: number, stepMs: number, temperature: (i: number) => number): void {
  const insert = db.prepare(
    'INSERT INTO telemetry_cache (deviceId, time, temperature, humidity, batteryVoltage) VALUES (?, ?, ?, 60, 3.7)',
  );
  for (let i = 0; i < count; i++) {
    insert.run(deviceId, new Date(startMs + i * stepMs).toISOString(), temperature(i));
  }
}

function claimInput(over: Partial<CreateClaimInput> = {}): CreateClaimInput {
  return {
    hiveId: 'hive-test-1',
    hiveName: 'Hive hive-test-1',
    source: 'buzz-chat',
    advice: 'Hive 1 is running hot — check the ventilation this weekend.',
    claim: 'Hive 1 temperature returns under 95F within the week',
    metric: 'temperature',
    predicate: 'lt',
    threshold: 95,
    unit: 'F',
    windowStart: iso(-7 * DAY),
    windowEnd: iso(-1 * DAY),
    toleranceDays: 0,
    ...over,
  };
}

beforeEach(() => {
  db.exec('DELETE FROM advice_claim_grades');
  db.exec('DELETE FROM advice_claims');
  db.exec('DELETE FROM telemetry_cache');
  db.exec('DELETE FROM sensors');
  db.exec('DELETE FROM inspections');
  db.exec('DELETE FROM agentic_log');
  // feeding_events declares a FK to hives(entity_id), which is only uniquely
  // indexed partly (WHERE superseded_by IS NULL) — SQLite reports "foreign key
  // mismatch" for any DELETE on hives with enforcement on. Toggle it off for the
  // reset; these tests never rely on FK cascades.
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM hives');
  db.pragma('foreign_keys = ON');
});

describe('advice_claims schema', () => {
  it('is created by migration 012', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('advice_claims','advice_claim_grades')",
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['advice_claim_grades', 'advice_claims']);
  });
});

describe('validateClaim', () => {
  it('rejects a numeric predicate with no threshold', () => {
    expect(() => validateClaim(claimInput({ threshold: null })))
      .toThrow(ClaimValidationError);
  });

  it('rejects a window that closes before it opens', () => {
    expect(() => validateClaim(claimInput({ windowStart: iso(0), windowEnd: iso(-DAY) })))
      .toThrow(/must be after windowStart/);
  });

  it('rejects between with inverted bounds', () => {
    expect(() => validateClaim(claimInput({ predicate: 'between', threshold: 95, threshold2: 90 })))
      .toThrow(/below threshold2/);
  });

  it('rejects confidence outside 0..1', () => {
    expect(() => validateClaim(claimInput({ confidence: 1.4 })))
      .toThrow(/confidence/);
  });

  it('accepts an observation claim with no numbers at all', () => {
    expect(() => validateClaim(claimInput({
      metric: 'observation', predicate: 'observed', threshold: null, threshold2: null,
    }))).not.toThrow();
  });
});

describe('createClaim defaults', () => {
  it('defaults a numeric claim to basis=final — a threshold is about the end state', () => {
    const c = createClaim(claimInput());
    expect(c.basis).toBe('final');
    expect(c.status).toBe('open');
    expect(c.grade).toBeNull();
  });

  it('defaults a presence claim to basis=any — it only has to happen once', () => {
    const c = createClaim(claimInput({
      metric: 'observation', predicate: 'observed', threshold: null, threshold2: null,
    }));
    expect(c.basis).toBe('any');
  });

  it('keeps confidence and rationale, which the grader must never read', () => {
    const c = createClaim(claimInput({ confidence: 0.7, rationale: 'sensor trend + July flow' }));
    expect(c.confidence).toBe(0.7);
    expect(c.rationale).toBe('sensor trend + July flow');
  });
});

describe('dueClaims', () => {
  it('does not surface a claim whose window is still open', () => {
    const c = createClaim(claimInput({ windowStart: iso(0), windowEnd: iso(DAY) }));
    expect(dueClaims(iso(0)).map((x) => x.id)).not.toContain(c.id);
  });

  it('honours tolerance_days before grading', () => {
    const c = createClaim(claimInput({ windowEnd: iso(-1 * DAY), toleranceDays: 2 }));
    expect(dueClaims(iso(0)).map((x) => x.id)).not.toContain(c.id);
    expect(dueClaims(iso(3 * DAY)).map((x) => x.id)).toContain(c.id);
  });

  it('drops a claim once it has been graded', () => {
    const c = createClaim(claimInput({ windowEnd: iso(-2 * DAY), toleranceDays: 0 }));
    expect(dueClaims(iso(0)).map((x) => x.id)).toContain(c.id);
    recordGrade({ claimId: c.id, grader: 'deterministic', grade: 'confirmed', reason: 'ok' });
    expect(dueClaims(iso(0)).map((x) => x.id)).not.toContain(c.id);
  });
});

describe('gradeNumeric', () => {
  it('confirms when the final reading satisfies the predicate', () => {
    seedHive('hive-test-1', 'dev-1');
    // 60 readings across the window, cooling to 90F by the end.
    seedTelemetry('dev-1', Date.now() - 6 * DAY, 60, 2 * HOUR, (i) => 100 - i * 0.2);
    const c = createClaim(claimInput());
    const v = gradeNumeric(c);
    expect(v.grade).toBe('confirmed');
    expect(v.reason).toMatch(/satisfies/);
    expect(v.observed.readings).toBe(60);
  });

  it('refutes when the final reading misses the predicate', () => {
    seedHive('hive-test-1', 'dev-1');
    seedTelemetry('dev-1', Date.now() - 6 * DAY, 60, 2 * HOUR, () => 98.5);
    const c = createClaim(claimInput());
    expect(gradeNumeric(c).grade).toBe('refuted');
  });

  it('is unverifiable — not refuted — when the sensor never reported', () => {
    seedHive('hive-test-1', 'dev-1');
    const c = createClaim(claimInput());
    const v = gradeNumeric(c);
    expect(v.grade).toBe('unverifiable');
    expect(v.reason).toMatch(/no temperature readings/);
  });

  it('is unverifiable when the hive has no bound sensor', () => {
    seedHive('hive-test-1', 'dev-1');
    const c = createClaim(claimInput({ hiveId: 'hive-without-sensors' }));
    expect(gradeNumeric(c).grade).toBe('unverifiable');
  });

  it('is unverifiable when a telemetry gap sits inside the window', () => {
    seedHive('hive-test-1', 'dev-1');
    const start = Date.now() - 6 * DAY;
    // Two bursts with a 30h hole between them — the sensors were not watching.
    seedTelemetry('dev-1', start, 20, 10 * 60_000, () => 90);
    seedTelemetry('dev-1', start + 32 * HOUR, 20, 10 * 60_000, () => 90);
    const c = createClaim(claimInput());
    const v = gradeNumeric(c);
    expect(v.grade).toBe('unverifiable');
    expect(v.reason).toMatch(/gap/);
  });

  it('is unverifiable when readings are too sparse to mean anything', () => {
    seedHive('hive-test-1', 'dev-1');
    seedTelemetry('dev-1', Date.now() - 6 * DAY, 5, HOUR, () => 90);
    expect(gradeNumeric(createClaim(claimInput())).grade).toBe('unverifiable');
  });

  it('grades a majority-basis claim as partial when the window is mixed', () => {
    seedHive('hive-test-1', 'dev-1');
    // 50 readings, half above and half below 95.
    seedTelemetry('dev-1', Date.now() - 6 * DAY, 50, 2 * HOUR, (i) => (i % 2 === 0 ? 90 : 100));
    const c = createClaim(claimInput({ basis: 'majority' }));
    expect(gradeNumeric(c).grade).toBe('partial');
  });

  it('joins a colon-separated sensor MAC to a stripped telemetry device id', () => {
    // sensors store '47:12:C8'; telemetry_cache stores '4712c8'. Comparing the
    // raw values matches nothing and silently grades every claim unverifiable.
    seedHive('hive-test-1', '47:12:C8');
    seedTelemetry('4712c8', Date.now() - 6 * DAY, 60, 2 * HOUR, () => 90);
    const v = gradeNumeric(createClaim(claimInput()));
    expect(v.observed.readings).toBe(60);
    expect(v.grade).toBe('confirmed');
  });

  it('grades a weight claim against inspection weight, not telemetry', () => {
    seedHive('hive-test-1', 'dev-1');
    db.prepare(
      'INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) ' +
      "VALUES (?, ?, 1, NULL, NULL, 'hive-test-1', ?, 1, 0, 'solid', 1, 1, 1, 'calm', 'full', 'good', 'strong', 52, 'healthy', 0, 0, '', '[]')",
    ).run(genId('insp'), genId('insp'), iso(-2 * DAY));

    const c = createClaim(claimInput({
      metric: 'weight', predicate: 'gt', threshold: 45, unit: 'lb',
    }));
    expect(gradeNumeric(c).grade).toBe('confirmed');
  });
});

describe('recordGrade / accuracySummary', () => {
  it('mirrors the verdict onto the claim and keeps an append-only trail', () => {
    const c = createClaim(claimInput());
    recordGrade({ claimId: c.id, grader: 'deterministic', grade: 'refuted', reason: 'stayed 98F' });
    recordGrade({ claimId: c.id, grader: 'human:mark', grade: 'confirmed', reason: 'sensor was miscalibrated' });

    const after = getClaim(c.id)!;
    expect(after.status).toBe('graded');
    expect(after.grade).toBe('confirmed');
    expect(after.gradeBasis).toBe('human');

    const grades = db.prepare(
      'SELECT grade FROM advice_claim_grades WHERE claimId = ? ORDER BY gradedAt ASC',
    ).all(c.id) as { grade: string }[];
    expect(grades.map((g) => g.grade)).toEqual(['refuted', 'confirmed']);
  });

  it('counts a re-graded claim once, not twice', () => {
    const c = createClaim(claimInput());
    recordGrade({ claimId: c.id, grader: 'deterministic', grade: 'refuted', reason: 'a' });
    recordGrade({ claimId: c.id, grader: 'human:mark', grade: 'confirmed', reason: 'b' });
    const s = accuracySummary();
    expect(s.confirmed).toBe(1);
    expect(s.refuted).toBe(0);
    expect(s.strictAccuracy).toBe(1);
  });

  it('excludes unverifiable from accuracy — an unseen claim is not a wrong call', () => {
    const a = createClaim(claimInput({ claim: 'claim a' }));
    const b = createClaim(claimInput({ claim: 'claim b', hiveId: 'hive-test-1' }));
    recordGrade({ claimId: a.id, grader: 'deterministic', grade: 'confirmed', reason: 'ok' });
    recordGrade({ claimId: b.id, grader: 'deterministic', grade: 'unverifiable', reason: 'no data' });

    const s = accuracySummary();
    expect(s.total).toBe(2);
    expect(s.confirmed).toBe(1);
    expect(s.unverifiable).toBe(1);
    expect(s.accuracy).toBe(1);
  });

  it('reports null accuracy when nothing is decided', () => {
    createClaim(claimInput());
    const s = accuracySummary();
    expect(s.accuracy).toBeNull();
    expect(s.open).toBe(1);
  });

  it('builds a calibration curve from stated confidence', () => {
    const hi = createClaim(claimInput({ claim: 'hi', confidence: 0.9 }));
    const lo = createClaim(claimInput({ claim: 'lo', confidence: 0.3 }));
    recordGrade({ claimId: hi.id, grader: 'deterministic', grade: 'confirmed', reason: 'ok' });
    recordGrade({ claimId: lo.id, grader: 'deterministic', grade: 'refuted', reason: 'no' });

    const cal = accuracySummary().calibration;
    expect(cal.find((b) => b.bucket === '0.8-1.0')).toEqual({ bucket: '0.8-1.0', n: 1, confirmed: 1, rate: 1 });
    expect(cal.find((b) => b.bucket === '0.0-0.4')).toEqual({ bucket: '0.0-0.4', n: 1, confirmed: 0, rate: 0 });
  });
});

describe('voidClaim', () => {
  it('takes a claim out of the ledger without grading it', () => {
    const c = createClaim(claimInput({ windowEnd: iso(DAY) }));
    voidClaim(c.id, 'advice superseded by a later inspection');
    const after = getClaim(c.id)!;
    expect(after.status).toBe('void');
    expect(after.grade).toBeNull();
    expect(dueClaims(iso(30 * DAY)).map((x) => x.id)).not.toContain(c.id);
    expect(listClaims({ status: 'void' }).map((x) => x.id)).toContain(c.id);
  });
});

describe('parseVerdicts', () => {
  it('reads a clean JSON array', () => {
    const m = parseVerdicts('[{"claimId":"c1","grade":"confirmed","reason":"temp fell to 88F"}]');
    expect(m.get('c1')?.grade).toBe('confirmed');
  });

  it('survives a fenced code block and surrounding prose', () => {
    const m = parseVerdicts('Here you go:\n```json\n[{"claimId":"c2","grade":"REFUTED","reason":"stayed hot"}]\n```\nHope that helps.');
    expect(m.get('c2')?.grade).toBe('refuted');
  });

  it('drops an invalid grade rather than inventing one', () => {
    const m = parseVerdicts('[{"claimId":"c3","grade":"maybe","reason":"unclear"}]');
    expect(m.has('c3')).toBe(false);
  });

  it('returns empty on unparseable output', () => {
    expect(parseVerdicts('I could not grade these.').size).toBe(0);
  });
});
