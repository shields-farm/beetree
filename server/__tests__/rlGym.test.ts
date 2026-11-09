// Tests for the BeeTree RL environment. The reward must be able to distinguish
// an alert from a missed anomaly, and a confirmed claim from an unseen one.

import { beforeEach, describe, expect, it } from 'vitest';
import { db, genId, type BeetreeDb } from '../db.js';
import { createClaim, type AdviceClaim } from '../adviceClaims.js';
import {
  buildTask, detectAnomalies, generateTasks, gradeClaimsForTask, nullPolicy,
  rulesPolicy, scoreEpisode, summarizeTelemetry,
  type RlTask, type RlToolCall,
} from '../rlGym.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const CUTOFF = Date.parse('2026-08-15T00:00:00.000Z');

function seedHive(hiveId = 'hive-rl', deviceId = '47:12:C8'): void {
  db.prepare(
    'INSERT INTO hives (id, entity_id, version, superseded_by, superseded_at, apiaryId, name, type, healthStatus, sensorIds, createdAt) ' +
    "VALUES (?, ?, 1, NULL, NULL, 'apiary-1', ?, 'langstroth', 'good', '[]', ?)",
  ).run(genId('hive'), hiveId, `Hive ${hiveId}`, new Date(CUTOFF - 30 * DAY).toISOString());
  db.prepare(
    'INSERT INTO sensors (id, entity_id, version, superseded_by, superseded_at, deviceId, name, model, hiveId) ' +
    "VALUES (?, ?, 1, NULL, NULL, ?, ?, 'TH-Pro', ?)",
  ).run(genId('sensor'), genId('sensor'), deviceId, `Sensor ${deviceId}`, hiveId);
}

function seedTelemetry(
  deviceId: string,
  start: number,
  count: number,
  step: number,
  temperature: (i: number) => number,
  humidity: (i: number) => number = () => 60,
): void {
  const insert = db.prepare(
    'INSERT INTO telemetry_cache (deviceId, time, temperature, humidity, batteryVoltage) VALUES (?, ?, ?, ?, 3.7)',
  );
  for (let i = 0; i < count; i++) {
    insert.run(deviceId, new Date(start + i * step).toISOString(), temperature(i), humidity(i));
  }
}

function seedWindow(temp: number, futureTemp = temp): void {
  seedTelemetry('4712c8', CUTOFF - 14 * DAY, 57, 6 * HOUR, () => temp);
  // Start just after cutoff; the label window has enough readings to grade.
  seedTelemetry('4712c8', CUTOFF + 6 * HOUR, 28, 6 * HOUR, () => futureTemp);
}

function taskFor(temp: number, futureTemp = temp): RlTask {
  seedWindow(temp, futureTemp);
  const task = buildTask(db, {
    entity_id: 'hive-rl', name: 'Hive rl', healthStatus: 'good',
  }, CUTOFF, { generatedAt: '2026-11-09T00:00:00.000Z' });
  expect(task).not.toBeNull();
  return task!;
}

function recordedClaim(task: RlTask, over: Record<string, unknown> = {}): AdviceClaim {
  return createClaim({
    hiveId: task.hiveId,
    hiveName: task.hiveName,
    source: 'manual',
    advice: 'Inspect the hive for the sustained hot reading.',
    claim: 'Temperature returns below 99F by the horizon',
    metric: 'temperature',
    predicate: 'lt',
    threshold: 99,
    unit: 'F',
    confidence: 0.55,
    windowStart: task.cutoff,
    windowEnd: task.labelEnd,
    toleranceDays: 0,
    ...over,
  });
}

beforeEach(() => {
  db.exec('DELETE FROM advice_claim_grades');
  db.exec('DELETE FROM advice_claims');
  db.exec('DELETE FROM telemetry_cache');
  db.exec('DELETE FROM sensors');
  db.exec('DELETE FROM inspections');
  db.exec('DELETE FROM tasks');
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM hives');
  db.pragma('foreign_keys = ON');
  seedHive();
});

describe('telemetry labels', () => {
  it('uses sustained shares rather than a single spike', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      time: new Date(CUTOFF - (20 - i) * HOUR).toISOString(),
      temperature: i === 0 ? 101 : 95,
      humidity: 60,
      batteryVoltage: 3.7,
    }));
    const summary = summarizeTelemetry(rows);
    expect(summary.hotShare).toBe(0.05);
    expect(detectAnomalies([{
      sensorId: 's-1', deviceId: 'dev', name: 'Sensor', model: 'TH', telemetry: summary,
    }])).toEqual([]);
  });

  it('labels a sustained hot window as an inspect task', () => {
    const task = taskFor(100, 90);
    expect(task.kind).toBe('anomaly');
    expect(task.label.expectedDecision).toBe('inspect');
    expect(task.label.anomalies.map(a => a.kind)).toContain('heat');
    expect(Date.parse(task.context.sensors[0].telemetry.last!)).toBeLessThanOrEqual(Date.parse(task.cutoff));
    expect(task.label.futureReadings).toBeGreaterThanOrEqual(24);
  });

  it('labels a quiet window as wait', () => {
    const task = taskFor(95);
    expect(task.kind).toBe('quiet');
    expect(task.label.expectedDecision).toBe('wait');
    expect(task.label.anomalies).toEqual([]);
  });

  it('reports hives with no sensor instead of silently omitting them', () => {
    seedWindow(95);
    seedHive('hive-unsensed', '47:AA:AA');
    db.prepare("DELETE FROM telemetry_cache WHERE deviceId = '47aaaa'").run();
    const report = generateTasks(db, { contextDays: 7, horizonDays: 3, stepDays: 7, limit: 10 });
    expect(report.hivesConsidered).toBe(2);
    // The second synthetic hive has a direct binding but no rows, so the report
    // must name why it produced no tasks rather than disappearing from coverage.
    expect(report.skippedHives.map(h => h.hiveId)).toContain('hive-unsensed');
    expect(report.tasks.every(t => t.hiveId === 'hive-rl')).toBe(true);
  });
});

describe('policies and reward polarity', () => {
  const noTools: RlToolCall[] = [];

  it('rules policy reads visible context and scores above null on an anomaly', async () => {
    const task = taskFor(100, 90);
    const rules = rulesPolicy(task);
    const claim = recordedClaim(task);
    const grades = await gradeClaimsForTask(task, [claim], db as BeetreeDb);
    expect(grades[0].grade).toBe('confirmed');

    const rulesScore = scoreEpisode(task, rules, noTools, grades);
    const nullScore = scoreEpisode(task, nullPolicy(task), noTools, []);
    expect(rulesScore.total).toBeGreaterThan(nullScore.total);
    expect(nullScore.flags).toContain('missed_anomaly');
    expect(nullScore.flags).toContain('missing_falsifiable_claim');
  });

  it('refutes the same claim when the future stays hot', async () => {
    const task = taskFor(100, 100);
    const claim = recordedClaim(task);
    const grades = await gradeClaimsForTask(task, [claim], db as BeetreeDb);
    expect(grades[0].grade).toBe('refuted');
    expect(scoreEpisode(task, rulesPolicy(task), noTools, grades).components.outcome).toBe(0);
  });

  it('does not treat an observation claim as a refuted numeric prediction', async () => {
    const task = taskFor(100, 100);
    const claim = recordedClaim(task, {
      metric: 'observation', predicate: 'observed', threshold: null, unit: null,
      claim: 'The next inspection finds a problem',
    });
    const grades = await gradeClaimsForTask(task, [claim], db as BeetreeDb);
    expect(grades[0].grade).toBe('unverifiable');
    const score = scoreEpisode(task, rulesPolicy(task), noTools, grades);
    expect(score.components.outcome).toBeNull();
  });

  it('masks claims whose window extends beyond the available label horizon', async () => {
    const task = taskFor(100, 90);
    const claim = recordedClaim(task, { windowEnd: new Date(CUTOFF + 30 * DAY).toISOString() });
    const grades = await gradeClaimsForTask(task, [claim], db as BeetreeDb);
    expect(grades[0].grade).toBe('unverifiable');
    expect(grades[0].reason).toMatch(/beyond/);
  });

  it('treats overdue high-priority work as maintenance, not a quiet-control false positive', () => {
    db.prepare(
      'INSERT INTO tasks (id, entity_id, version, superseded_by, superseded_at, hiveId, title, dueDate, priority, completed) ' +
      "VALUES (?, ?, 1, NULL, NULL, 'hive-rl', 'Add honey super', ?, 'high', 0)",
    ).run(genId('task'), genId('task'), new Date(CUTOFF - 2 * DAY).toISOString());
    const task = taskFor(95);
    expect(task.kind).toBe('maintenance');
    expect(task.label.expectedDecision).toBe('inspect');
    expect(task.label.overdueTasks.map(t => t.title)).toEqual(['Add honey super']);
    const score = scoreEpisode(task, rulesPolicy(task), noTools, []);
    expect(score.components.decision).toBe(1);
    expect(score.flags).not.toContain('false_positive_inspection');
    expect(score.flags).not.toContain('missing_falsifiable_claim');
  });

  it('penalizes and flags an unnecessary urgent inspection on a quiet control', () => {
    const task = taskFor(95);
    const action = { decision: 'inspect' as const, urgency: 'urgent' as const, summary: 'Inspect now', claims: [] };
    const score = scoreEpisode(task, action, noTools, []);
    expect(score.total).toBeLessThan(scoreEpisode(task, nullPolicy(task), noTools, []).total);
    expect(score.flags).toContain('false_positive_inspection');
    expect(score.flags).toContain('unnecessary_urgency');
  });

  it('penalizes tool errors instead of counting every tool call as good behavior', () => {
    const task = taskFor(95);
    const badTools: RlToolCall[] = [
      { name: 'get_hives', args: {}, result: '{}', error: false, allowed: true },
      { name: 'get_weather', args: {}, result: '{"error":"unavailable"}', error: true, allowed: false },
    ];
    const score = scoreEpisode(task, nullPolicy(task), badTools, []);
    expect(score.components.toolDiscipline).toBe(0.5);
    expect(score.flags).toContain('tool_errors');
  });
});
