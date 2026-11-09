// server/rlGym.ts — replayable decision tasks for BeeTree's advisor.
//
// This is the environment/reward layer, not a trainer. It mines historical hive
// snapshots, hides everything after a cutoff from the acting agent, and keeps a
// second snapshot through labelEnd for deterministic outcome grading.
//
// The labels are deliberately modest: telemetry anomalies are operational labels,
// not proof that an inspection was causally necessary. Confirmed predictions are
// scored separately from decision quality so a lucky forecast cannot make a bad
// recommendation look good.

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BeetreeDb } from './db.js';
import type { AdviceClaim, ClaimGrade } from './adviceClaims.js';

const DAY_MS = 86_400_000;
const NUMERIC_METRICS = new Set(['temperature', 'humidity', 'weight', 'battery']);
const MIN_WINDOW_READINGS = 24;

export type RlDecision = 'inspect' | 'wait' | 'ask';
export type RlUrgency = 'routine' | 'soon' | 'urgent';
export type AnomalyKind = 'heat' | 'cold' | 'wet' | 'dry';

export interface TelemetrySummary {
  readings: number;
  first: string | null;
  last: string | null;
  minTemp: number | null;
  maxTemp: number | null;
  avgTemp: number | null;
  lastTemp: number | null;
  minHumidity: number | null;
  maxHumidity: number | null;
  avgHumidity: number | null;
  lastHumidity: number | null;
  lastBattery: number | null;
  maxGapHours: number;
  hotShare: number;
  coldShare: number;
  wetShare: number;
  dryShare: number;
}

export interface RlAnomaly {
  kind: AnomalyKind;
  sensorId: string;
  deviceId: string;
  evidence: string;
}

export interface RlSensorContext {
  sensorId: string;
  deviceId: string;
  name: string;
  model: string;
  telemetry: TelemetrySummary;
}

export interface RlTask {
  schemaVersion: 1;
  id: string;
  hiveId: string;
  hiveName: string;
  cutoff: string;
  labelEnd: string;
  contextDays: number;
  horizonDays: number;
  kind: 'anomaly' | 'maintenance' | 'quiet';
  prompt: string;
  context: {
    currentHealth: string;
    season: string;
    sensors: RlSensorContext[];
    recentInspections: Record<string, unknown>[];
    openTasks: Record<string, unknown>[];
  };
  label: {
    expectedDecision: RlDecision;
    anomalies: RlAnomaly[];
    overdueTasks: { entity_id: string; title: string; dueDate: string; priority: string }[];
    rationale: string;
    source: 'operational-heuristic-v1';
    futureReadings: number;
  };
  provenance: {
    source: 'beetree-db-replay';
    generatedAt: string;
    telemetryOnly: true;
  };
}

export interface RlClaimInput {
  hiveId: string;
  advice: string;
  claim: string;
  metric: 'temperature' | 'humidity' | 'weight' | 'battery' | 'inspection' | 'observation';
  predicate: 'lt' | 'gt' | 'between' | 'observed' | 'absent';
  threshold?: number;
  threshold2?: number;
  unit?: string;
  basis?: 'majority' | 'final' | 'any' | 'all';
  windowEnd: string;
  toleranceDays?: number;
  confidence?: number;
  rationale?: string;
}

export interface RlAction {
  decision: RlDecision;
  urgency: RlUrgency;
  summary: string;
  claims: RlClaimInput[];
}

export interface RlToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  error: boolean;
  allowed: boolean;
}

export interface RlClaimGrade {
  claimId: string;
  claim: string;
  metric: string;
  confidence: number | null;
  grade: ClaimGrade;
  reason: string;
}

export interface RlScore {
  total: number;
  components: {
    decision: number;
    claimProcess: number;
    outcome: number | null;
    toolDiscipline: number;
    calibration: number | null;
  };
  weights: Record<string, number>;
  flags: string[];
  reason: string;
}

export interface RlEpisodeResult {
  taskId: string;
  policy: string;
  model: string | null;
  action: RlAction;
  toolCalls: RlToolCall[];
  claims: RlClaimGrade[];
  score: RlScore;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

interface TelemetryRow {
  time: string;
  temperature: number | null;
  humidity: number | null;
  batteryVoltage: number | null;
}

interface SensorRow {
  sensorId: string;
  deviceId: string;
  name: string;
  model: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function round(n: number | null, digits = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function normalizeDeviceId(id: string): string {
  return id.replace(/:/g, '').toLowerCase();
}

function seasonFor(date: Date): string {
  const month = date.getUTCMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 8) return 'summer';
  if (month >= 9 && month <= 10) return 'fall';
  return 'winter';
}

function deviceIdsForHive(database: BeetreeDb, hiveId: string): string[] {
  const ids = new Set<string>();
  const direct = database.prepare(
    'SELECT DISTINCT deviceId FROM sensors WHERE hiveId = ? AND superseded_by IS NULL',
  ).all(hiveId) as { deviceId: string }[];
  for (const row of direct) if (row.deviceId) ids.add(normalizeDeviceId(row.deviceId));

  const hive = database.prepare(
    'SELECT sensorIds FROM hives WHERE entity_id = ? AND superseded_by IS NULL',
  ).get(hiveId) as { sensorIds: string } | undefined;
  let entityIds: string[] = [];
  try { entityIds = JSON.parse(hive?.sensorIds || '[]'); } catch { /* direct bindings remain */ }
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => '?').join(',');
    const rows = database.prepare(
      `SELECT DISTINCT deviceId FROM sensors WHERE entity_id IN (${placeholders}) AND superseded_by IS NULL`,
    ).all(...entityIds) as { deviceId: string }[];
    for (const row of rows) if (row.deviceId) ids.add(normalizeDeviceId(row.deviceId));
  }
  return [...ids];
}

function telemetryForSensor(
  database: BeetreeDb,
  deviceId: string,
  start: string,
  end: string,
): TelemetryRow[] {
  return database.prepare(
    `SELECT time, temperature, humidity, batteryVoltage
       FROM telemetry_cache
      WHERE lower(replace(deviceId, ':', '')) = ?
        AND time >= ? AND time <= ?
      ORDER BY time ASC`,
  ).all(normalizeDeviceId(deviceId), start, end) as TelemetryRow[];
}

function emptySummary(): TelemetrySummary {
  return {
    readings: 0, first: null, last: null,
    minTemp: null, maxTemp: null, avgTemp: null, lastTemp: null,
    minHumidity: null, maxHumidity: null, avgHumidity: null, lastHumidity: null,
    lastBattery: null, maxGapHours: 0,
    hotShare: 0, coldShare: 0, wetShare: 0, dryShare: 0,
  };
}

export function summarizeTelemetry(rows: TelemetryRow[]): TelemetrySummary {
  if (rows.length === 0) return emptySummary();
  const temps = rows.map(r => r.temperature).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const humidity = rows.map(r => r.humidity).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const batteries = rows.map(r => r.batteryVoltage).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let maxGapHours = 0;
  for (let i = 1; i < rows.length; i++) {
    const gap = (Date.parse(rows[i].time) - Date.parse(rows[i - 1].time)) / 3_600_000;
    if (Number.isFinite(gap)) maxGapHours = Math.max(maxGapHours, gap);
  }
  const share = (values: number[], predicate: (n: number) => boolean): number =>
    values.length === 0 ? 0 : values.filter(predicate).length / values.length;

  return {
    readings: rows.length,
    first: rows[0].time,
    last: rows[rows.length - 1].time,
    minTemp: temps.length ? round(Math.min(...temps), 1) : null,
    maxTemp: temps.length ? round(Math.max(...temps), 1) : null,
    avgTemp: temps.length ? round(temps.reduce((a, b) => a + b, 0) / temps.length, 1) : null,
    lastTemp: temps.length ? round(temps[temps.length - 1], 1) : null,
    minHumidity: humidity.length ? round(Math.min(...humidity), 1) : null,
    maxHumidity: humidity.length ? round(Math.max(...humidity), 1) : null,
    avgHumidity: humidity.length ? round(humidity.reduce((a, b) => a + b, 0) / humidity.length, 1) : null,
    lastHumidity: humidity.length ? round(humidity[humidity.length - 1], 1) : null,
    lastBattery: batteries.length ? round(batteries[batteries.length - 1], 2) : null,
    maxGapHours: round(maxGapHours, 1) ?? 0,
    hotShare: round(share(temps, n => n >= 99), 3) ?? 0,
    coldShare: round(share(temps, n => n <= 85), 3) ?? 0,
    wetShare: round(share(humidity, n => n >= 92), 3) ?? 0,
    // Zero humidity is treated as an implausible/missing reading, not dry brood.
    dryShare: round(share(humidity, n => n > 0 && n <= 25), 3) ?? 0,
  };
}

export function detectAnomalies(sensors: RlSensorContext[]): RlAnomaly[] {
  const anomalies: RlAnomaly[] = [];
  for (const sensor of sensors) {
    const t = sensor.telemetry;
    if (t.readings < MIN_WINDOW_READINGS) continue;
    const add = (kind: AnomalyKind, evidence: string) => {
      anomalies.push({ kind, sensorId: sensor.sensorId, deviceId: sensor.deviceId, evidence });
    };
    // A share threshold rejects one-off spikes and sensor glitches. These are
    // operational triage labels, not declarations of colony disease.
    if (t.hotShare >= 0.2) add('heat', `${Math.round(t.hotShare * 100)}% of ${t.readings} readings were >=99F`);
    if (t.coldShare >= 0.2) add('cold', `${Math.round(t.coldShare * 100)}% of ${t.readings} readings were <=85F`);
    if (t.wetShare >= 0.2) add('wet', `${Math.round(t.wetShare * 100)}% of ${t.readings} readings were >=92% RH`);
    if (t.dryShare >= 0.2) add('dry', `${Math.round(t.dryShare * 100)}% of ${t.readings} readings were 0–25% RH (zero excluded)`);
  }
  return anomalies;
}

function sensorsForHive(database: BeetreeDb, hiveId: string): SensorRow[] {
  return database.prepare(
    `SELECT entity_id AS sensorId, deviceId, name, model
       FROM sensors WHERE hiveId = ? AND superseded_by IS NULL ORDER BY entity_id`,
  ).all(hiveId) as SensorRow[];
}

export function buildTask(
  database: BeetreeDb,
  hive: { entity_id: string; name: string; healthStatus: string },
  cutoffMs: number,
  options: { contextDays?: number; horizonDays?: number; generatedAt?: string } = {},
): RlTask | null {
  const contextDays = options.contextDays ?? 14;
  const horizonDays = options.horizonDays ?? 7;
  const cutoff = iso(cutoffMs);
  const labelEnd = iso(cutoffMs + horizonDays * DAY_MS);
  const contextStart = iso(cutoffMs - contextDays * DAY_MS);

  const sensors = sensorsForHive(database, hive.entity_id).map(sensor => ({
    ...sensor,
    telemetry: summarizeTelemetry(telemetryForSensor(database, sensor.deviceId, contextStart, cutoff)),
  }));
  if (sensors.length === 0 || sensors.every(s => s.telemetry.readings < MIN_WINDOW_READINGS)) return null;

  const devices = deviceIdsForHive(database, hive.entity_id);
  let futureReadings = 0;
  if (devices.length > 0) {
    const placeholders = devices.map(() => '?').join(',');
    const row = database.prepare(
      `SELECT count(*) AS n FROM telemetry_cache
        WHERE lower(replace(deviceId, ':', '')) IN (${placeholders})
          AND time > ? AND time <= ?`,
    ).get(...devices, cutoff, labelEnd) as { n: number };
    futureReadings = row.n;
  }
  if (futureReadings < MIN_WINDOW_READINGS) return null;

  const anomalies = detectAnomalies(sensors);
  const recentInspections = database.prepare(
    `SELECT entity_id, date, queenPresent, queenCells, queenLayingPattern,
            eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores,
            pollenStores, populationSize, hiveWeight, healthStatus, colonyDead, notes
       FROM inspections
      WHERE hiveId = ? AND superseded_by IS NULL AND date <= ?
      ORDER BY date DESC LIMIT 5`,
  ).all(hive.entity_id, cutoff) as Record<string, unknown>[];
  const openTasks = database.prepare(
    `SELECT entity_id, title, description, dueDate, priority
       FROM tasks
      WHERE hiveId = ? AND superseded_by IS NULL AND completed = 0
        AND (dueDate IS NULL OR dueDate <= ?)
      ORDER BY dueDate ASC LIMIT 10`,
  ).all(hive.entity_id, cutoff) as Record<string, unknown>[];

  const overdueTasks = openTasks.filter(task =>
    typeof task.dueDate === 'string'
    && Date.parse(task.dueDate) < cutoffMs
    && ['high', 'urgent'].includes(String(task.priority)),
  ).map(task => ({
    entity_id: String(task.entity_id),
    title: String(task.title),
    dueDate: String(task.dueDate),
    priority: String(task.priority),
  }));
  const expectedDecision: RlDecision = anomalies.length > 0 || overdueTasks.length > 0 ? 'inspect' : 'wait';
  const anomalyText = anomalies.length > 0
    ? anomalies.map(a => `${a.kind}: ${a.evidence}`).join('; ')
    : 'No sustained temperature/humidity anomaly crossed the v1 thresholds.';
  const maintenanceText = overdueTasks.length > 0
    ? ` Overdue high-priority maintenance: ${overdueTasks.map(t => t.title).join('; ')}.`
    : '';
  const id = `rl-${hive.entity_id}-${cutoff.slice(0, 10)}`;

  return {
    schemaVersion: 1,
    id,
    hiveId: hive.entity_id,
    hiveName: hive.name,
    cutoff,
    labelEnd,
    contextDays,
    horizonDays,
    kind: anomalies.length > 0 ? 'anomaly' : overdueTasks.length > 0 ? 'maintenance' : 'quiet',
    prompt: `It is ${cutoff}. Review ${hive.name} using only information available now. Decide whether the beekeeper should inspect, wait, or ask for more evidence. Record a falsifiable claim for any predictive advice.`,
    context: {
      currentHealth: hive.healthStatus,
      season: seasonFor(new Date(cutoffMs)),
      sensors,
      recentInspections,
      openTasks,
    },
    label: {
      expectedDecision,
      anomalies,
      overdueTasks,
      rationale: anomalyText + maintenanceText,
      source: 'operational-heuristic-v1',
      futureReadings,
    },
    provenance: {
      source: 'beetree-db-replay',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      telemetryOnly: true,
    },
  };
}

export interface GenerateTasksOptions {
  limit?: number;
  stepDays?: number;
  contextDays?: number;
  horizonDays?: number;
  generatedAt?: string;
}

export interface GenerateTasksReport {
  tasks: RlTask[];
  hivesConsidered: number;
  hivesWithTasks: number;
  candidateCutoffs: number;
  skippedHives: { hiveId: string; hiveName: string; reason: string }[];
}

export function generateTasks(database: BeetreeDb, options: GenerateTasksOptions = {}): GenerateTasksReport {
  const limit = options.limit ?? 40;
  const stepDays = options.stepDays ?? 3;
  const contextDays = options.contextDays ?? 14;
  const horizonDays = options.horizonDays ?? 7;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const hives = database.prepare(
    'SELECT entity_id, name, healthStatus FROM hives WHERE superseded_by IS NULL ORDER BY entity_id',
  ).all() as { entity_id: string; name: string; healthStatus: string }[];

  const tasks: RlTask[] = [];
  const skippedHives: GenerateTasksReport['skippedHives'] = [];
  let candidateCutoffs = 0;

  for (const hive of hives) {
    const devices = deviceIdsForHive(database, hive.entity_id);
    if (devices.length === 0) {
      skippedHives.push({ hiveId: hive.entity_id, hiveName: hive.name, reason: 'no bound sensor' });
      continue;
    }
    const placeholders = devices.map(() => '?').join(',');
    const range = database.prepare(
      `SELECT min(time) AS first, max(time) AS last FROM telemetry_cache
        WHERE lower(replace(deviceId, ':', '')) IN (${placeholders})`,
    ).get(...devices) as { first: string | null; last: string | null };
    if (!range.first || !range.last) {
      skippedHives.push({ hiveId: hive.entity_id, hiveName: hive.name, reason: 'no telemetry' });
      continue;
    }
    const first = Date.parse(range.first) + contextDays * DAY_MS;
    const last = Date.parse(range.last) - horizonDays * DAY_MS;
    let produced = 0;
    for (let cutoff = first; cutoff <= last; cutoff += stepDays * DAY_MS) {
      candidateCutoffs += 1;
      const task = buildTask(database, hive, cutoff, { contextDays, horizonDays, generatedAt });
      if (task) { tasks.push(task); produced += 1; }
    }
    if (produced === 0) {
      skippedHives.push({ hiveId: hive.entity_id, hiveName: hive.name, reason: 'no cutoff had enough past and future readings' });
    }
  }

  // Balance both decision class and hive. A global anomaly-first interleave can
  // fill a small eval with one hive and make the score a hive-specific result.
  const byHive = new Map<string, RlTask[]>();
  for (const task of tasks) {
    const group = byHive.get(task.hiveId) ?? [];
    group.push(task);
    byHive.set(task.hiveId, group);
  }
  const queues = [...byHive.values()].map(group => {
    const buckets = ['anomaly', 'maintenance', 'quiet'].map(kind => group.filter(t => t.kind === kind));
    const interleaved: RlTask[] = [];
    let index = 0;
    while (buckets.some(bucket => index < bucket.length)) {
      for (const bucket of buckets) if (index < bucket.length) interleaved.push(bucket[index]);
      index += 1;
    }
    return interleaved;
  });
  const selected: RlTask[] = [];
  let round = 0;
  while (selected.length < limit && queues.some(q => round < q.length)) {
    for (const queue of queues) {
      if (round < queue.length && selected.length < limit) selected.push(queue[round]);
    }
    round += 1;
  }
  const covered = new Set(selected.map(t => t.hiveId));
  return {
    tasks: selected,
    hivesConsidered: hives.length,
    hivesWithTasks: covered.size,
    candidateCutoffs,
    skippedHives,
  };
}

export function nullPolicy(task: RlTask): RlAction {
  return {
    decision: 'wait', urgency: 'routine',
    summary: `No action recommended for ${task.hiveName}.`,
    claims: [],
  };
}

export function rulesPolicy(task: RlTask): RlAction {
  // Derive from the visible context, never task.label: labels are for scoring.
  const anomalies = detectAnomalies(task.context.sensors);
  if (anomalies.length === 0) {
    const overdue = task.context.openTasks.filter(open =>
      typeof open.dueDate === 'string'
      && Date.parse(open.dueDate) < Date.parse(task.cutoff)
      && ['high', 'urgent'].includes(String(open.priority)),
    );
    if (overdue.length === 0) return nullPolicy(task);
    return {
      decision: 'inspect', urgency: 'soon',
      summary: `Inspect ${task.hiveName}: overdue high-priority maintenance — ${overdue.map(t => String(t.title)).join('; ')}.`,
      claims: [],
    };
  }
  const claims: RlClaimInput[] = anomalies.map(anomaly => {
    const base = {
      hiveId: task.hiveId,
      windowEnd: task.labelEnd,
      toleranceDays: 0,
      confidence: 0.55,
      rationale: 'Deterministic telemetry-threshold baseline; not a causal treatment claim.',
    };
    if (anomaly.kind === 'heat') return {
      ...base, metric: 'temperature' as const, predicate: 'lt' as const, threshold: 99, unit: 'F',
      advice: `Inspect ${task.hiveName} for a sustained hot brood-nest reading.`,
      claim: `Final temperature is below 99F by ${task.labelEnd}`,
    };
    if (anomaly.kind === 'cold') return {
      ...base, metric: 'temperature' as const, predicate: 'gt' as const, threshold: 85, unit: 'F',
      advice: `Inspect ${task.hiveName} for a sustained cold brood-nest reading.`,
      claim: `Final temperature is above 85F by ${task.labelEnd}`,
    };
    if (anomaly.kind === 'wet') return {
      ...base, metric: 'humidity' as const, predicate: 'lt' as const, threshold: 92, unit: '%',
      advice: `Inspect ${task.hiveName} for sustained high humidity and ventilation problems.`,
      claim: `Final humidity is below 92% by ${task.labelEnd}`,
    };
    return {
      ...base, metric: 'humidity' as const, predicate: 'gt' as const, threshold: 25, unit: '%',
      advice: `Inspect ${task.hiveName} for sustained low humidity and sensor placement problems.`,
      claim: `Final humidity is above 25% by ${task.labelEnd}`,
    };
  });
  return {
    decision: 'inspect', urgency: 'soon',
    summary: `Inspect ${task.hiveName}: ${anomalies.map(a => a.kind).join(', ')} crossed the sustained-reading threshold.`,
    claims,
  };
}

export async function gradeClaimsForTask(
  task: RlTask,
  claims: AdviceClaim[],
  labelDatabase: BeetreeDb,
): Promise<RlClaimGrade[]> {
  // Loaded only after the worker has pinned BEETREE_DB to the acting snapshot.
  const { gradeNumericWith } = await import('./adviceGrader.js');
  return claims.map(claim => {
    let grade: ClaimGrade;
    let reason: string;
    if (Date.parse(claim.windowEnd) > Date.parse(task.labelEnd)) {
      grade = 'unverifiable';
      reason = 'claim window extends beyond this replay task\'s label horizon';
    } else if (!NUMERIC_METRICS.has(claim.metric)) {
      grade = 'unverifiable';
      reason = 'observation/inspection claims need a separate audited grader; RL v1 does not guess';
    } else {
      const verdict = gradeNumericWith(labelDatabase, claim);
      grade = verdict.grade;
      reason = verdict.reason;
    }
    return {
      claimId: claim.id,
      claim: claim.claim,
      metric: claim.metric,
      confidence: claim.confidence,
      grade,
      reason,
    };
  });
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedTotal(components: RlScore['components']): { total: number; weights: Record<string, number> } {
  const weights: Record<string, number> = {
    decision: 0.40,
    claimProcess: 0.20,
    outcome: 0.25,
    toolDiscipline: 0.10,
    calibration: 0.05,
  };
  let numerator = 0;
  let denominator = 0;
  const used: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key as keyof RlScore['components']];
    if (value == null) continue;
    numerator += value * weight;
    denominator += weight;
    used[key] = weight;
  }
  return { total: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0, weights: used };
}

export function scoreEpisode(
  task: RlTask,
  action: RlAction,
  toolCalls: RlToolCall[],
  claims: RlClaimGrade[],
): RlScore {
  const expected = task.label.expectedDecision;
  const decision = action.decision === expected ? 1 : action.decision === 'ask' ? 0.5 : 0;
  const claimProcess = task.kind === 'anomaly'
    ? (claims.length > 0 ? 1 : 0)
    : task.kind === 'maintenance'
      ? (claims.length === 0 ? 1 : 0.75)
      : (claims.length === 0 ? 1 : 0.5);

  const verifiable = claims.filter(c => c.grade !== 'unverifiable');
  const gradeValue = (grade: ClaimGrade): number =>
    grade === 'confirmed' ? 1 : grade === 'partial' ? 0.5 : 0;
  const outcome = verifiable.length > 0 ? mean(verifiable.map(c => gradeValue(c.grade))) : null;

  const errors = toolCalls.filter(c => c.error || !c.allowed).length;
  const toolDiscipline = toolCalls.length === 0 ? 1 : Math.max(0, 1 - errors / toolCalls.length);
  const calibrated = verifiable.filter(c => c.confidence != null);
  const calibration = calibrated.length > 0
    ? 1 - mean(calibrated.map(c => ((c.confidence ?? 0.5) - gradeValue(c.grade)) ** 2))
    : null;

  const flags: string[] = [];
  if (expected === 'wait' && action.decision === 'inspect') flags.push('false_positive_inspection');
  if (expected === 'wait' && action.urgency === 'urgent') flags.push('unnecessary_urgency');
  if (expected === 'inspect' && action.decision === 'wait') {
    flags.push(task.kind === 'maintenance' ? 'missed_maintenance' : 'missed_anomaly');
  }
  if (task.kind === 'anomaly' && claims.length === 0) flags.push('missing_falsifiable_claim');
  if (claims.some(c => c.reason.includes('beyond this replay'))) flags.push('claim_beyond_label_horizon');
  if (errors > 0) flags.push('tool_errors');

  const components = { decision, claimProcess, outcome, toolDiscipline, calibration };
  const { total, weights } = weightedTotal(components);
  const outcomeText = outcome == null ? 'no verifiable outcome reward' : `outcome ${outcome.toFixed(2)}`;
  return {
    total,
    components: {
      decision: round(decision, 3) ?? 0,
      claimProcess: round(claimProcess, 3) ?? 0,
      outcome: round(outcome, 3),
      toolDiscipline: round(toolDiscipline, 3) ?? 0,
      calibration: round(calibration, 3),
    },
    weights,
    flags,
    reason: `decision ${decision.toFixed(2)} (expected ${expected}, got ${action.decision}); ${outcomeText}; ${claims.length} recorded claim(s); ${errors} tool error(s)`,
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) out[key] = 'true';
    else { out[key] = value; i += 1; }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.db == null || args.out == null) {
    throw new Error('usage: tsx server/rlGym.ts build --db COPY.db --out tasks.jsonl [--limit 40] [--step-days 3]');
  }
  const rawDatabase = new Database(args.db, { readonly: true, fileMustExist: true });
  const database = rawDatabase as unknown as BeetreeDb;
  try {
    const report = generateTasks(database, {
      limit: Number(args.limit ?? 40),
      stepDays: Number(args['step-days'] ?? 3),
      contextDays: Number(args['context-days'] ?? 14),
      horizonDays: Number(args['horizon-days'] ?? 7),
    });
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, report.tasks.map(t => JSON.stringify(t)).join('\n') + (report.tasks.length ? '\n' : ''));
    const byKind = report.tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.kind] = (acc[task.kind] ?? 0) + 1;
      return acc;
    }, {});
    const summary = {
      tasks: report.tasks.length,
      byKind,
      hivesConsidered: report.hivesConsidered,
      hivesWithTasks: report.hivesWithTasks,
      candidateCutoffs: report.candidateCutoffs,
      sourceData: {
        adviceClaims: (database.prepare('SELECT count(*) AS n FROM advice_claims').get() as { n: number }).n,
        gradedClaims: (database.prepare("SELECT count(*) AS n FROM advice_claims WHERE status = 'graded'").get() as { n: number }).n,
        inspections: (database.prepare('SELECT count(*) AS n FROM inspections WHERE superseded_by IS NULL').get() as { n: number }).n,
        chatMessages: (database.prepare('SELECT count(*) AS n FROM chat_messages').get() as { n: number }).n,
      },
      skippedHives: report.skippedHives,
      output: args.out,
      labelContract: 'Operational telemetry/maintenance heuristics, not causal proof that an inspection was necessary.',
    };
    writeFileSync(args.out.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    if (report.tasks.length === 0) process.exitCode = 2;
  } finally {
    rawDatabase.close();
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error('[rlGym] failed:', error);
    process.exit(1);
  });
}
