// server/adviceGrader.ts — the closing half of the advice loop.
//
// adviceClaims.ts records what the agent predicted. This reads what actually
// happened and writes a verdict. Two grading paths, deliberately separated:
//
//   1. NUMERIC (no model). A claim like "temp returns under 95F within 7 days"
//      is a predicate over rows that already exist in telemetry_cache or
//      inspections. Computing that in SQL is cheaper, deterministic, and immune
//      to the grader rationalizing. Most claims should land here.
//
//   2. OBSERVATION (one batched model call). A claim like "the spotty brood is
//      varroa, not a failing queen" cannot be decided by arithmetic. These go to
//      the model in batches, and the model sees ONLY the claim plus the evidence
//      recorded in the window — never `rationale`, never `confidence`. A grader
//      shown the original reasoning grades the reasoning, not the world.
//
// Nothing here retrains anything and nothing here writes advice. It writes
// verdicts, and the verdicts are what the eval set and the dashboard read.
//
// Run:
//   npx tsx server/adviceGrader.ts --dry-run        # print verdicts, write nothing
//   npx tsx server/adviceGrader.ts --limit 50
//   npx tsx server/adviceGrader.ts --claim claim-abc123

import { pathToFileURL } from 'node:url';
import { db, now } from './db.js';
import {
  dueClaims, getClaim, recordGrade, NUMERIC_METRICS,
  type AdviceClaim, type ClaimGrade,
} from './adviceClaims.js';
import { logAgenticEvent } from './agenticLog.js';

// ─── Config ─────────────────────────────────────────────────────────────────

// Same provider the Buzz chat lane uses. Read here rather than imported from
// index.ts: importing index.ts boots an HTTP server, which a CLI must not do.
const GRADER_URL = process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1/chat/completions';
const GRADER_KEY = process.env.HERMES_API_KEY || 'dev-hermes-api-key-replace-me';
const GRADER_MODEL = process.env.BEETREE_GRADER_MODEL || process.env.HERMES_MODEL || 'deepseek-v4.1-flash';

/** Below this many telemetry rows in the window, a numeric claim is unverifiable. */
const MIN_READINGS = 12;
/** A gap this wide inside the window means the sensors were not watching. */
const MAX_GAP_HOURS = 6;
/** Observation claims per model call. Keeps one bad response from sinking a night. */
const BATCH_SIZE = 8;
/** fraction of window readings that must satisfy the predicate to call 'majority'. */
const MAJORITY_CONFIRM = 0.8;
const MAJORITY_REFUTE = 0.2;

// ─── Telemetry helpers ──────────────────────────────────────────────────────

const METRIC_COLUMN: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  battery: 'batteryVoltage',
};

/** Device ids bound to a hive, normalized to what telemetry_cache actually stores.
 *
 * Two identifier spaces collide here and joining them naively silently returns
 * nothing (which grades every claim 'unverifiable'):
 *   sensors.deviceId      '47:12:C8'   — colon-separated MAC
 *   telemetry_cache.deviceId '4712c8'  — the same MAC with colons stripped
 *
 * influxdb.ts already normalizes this way (buildEntityId / buildEntityFilter),
 * so the grader must too. hives.sensorIds holds sensor ENTITY ids ('s-12c8'),
 * not device ids, so those are resolved through the sensors table.
 */
function normalizeDeviceId(id: string): string {
  return id.replace(/:/g, '').toLowerCase();
}

function deviceIdsForHive(hiveId: string): string[] {
  const ids = new Set<string>();

  for (const r of db.prepare(
    'SELECT DISTINCT deviceId FROM sensors WHERE hiveId = ? AND superseded_by IS NULL',
  ).all(hiveId) as { deviceId: string }[]) {
    if (r.deviceId) ids.add(normalizeDeviceId(r.deviceId));
  }

  const hive = db.prepare(
    'SELECT sensorIds FROM hives WHERE entity_id = ? AND superseded_by IS NULL',
  ).get(hiveId) as { sensorIds: string } | undefined;

  if (hive?.sensorIds) {
    let entityIds: string[] = [];
    try {
      entityIds = (JSON.parse(hive.sensorIds) as string[]).filter(Boolean);
    } catch { /* malformed JSON — the sensors table remains the authority */ }

    if (entityIds.length > 0) {
      const placeholders = entityIds.map(() => '?').join(',');
      for (const r of db.prepare(
        `SELECT DISTINCT deviceId FROM sensors WHERE entity_id IN (${placeholders}) AND superseded_by IS NULL`,
      ).all(...entityIds) as { deviceId: string }[]) {
        if (r.deviceId) ids.add(normalizeDeviceId(r.deviceId));
      }
    }
  }

  return [...ids];
}

interface WindowStats {
  readings: number;
  first: string | null;
  last: string | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  maxGapHours: number;
  /** Fraction of readings satisfying the predicate, or null when not applicable. */
  holdRate: number | null;
  /** Does the last reading (or the row that decides the basis) satisfy it? */
  lastHolds: boolean | null;
  /** The last value in the window — what a 'final'-basis verdict is about. */
  lastValue?: number | null;
  source: string;
}

function holds(predicate: string, value: number, t1: number | null, t2: number | null): boolean {
  switch (predicate) {
    case 'lt': return t1 != null && value < t1;
    case 'gt': return t1 != null && value > t1;
    case 'between': return t1 != null && t2 != null && value >= t1 && value <= t2;
    default: return false;
  }
}

function summarize(
  claim: AdviceClaim,
  points: { time: string; value: number | null }[],
  source: string,
): WindowStats {
  const valid = points.filter((p): p is { time: string; value: number } => typeof p.value === 'number' && Number.isFinite(p.value));
  if (valid.length === 0) {
    return { readings: 0, first: null, last: null, min: null, max: null, avg: null, maxGapHours: 0, holdRate: null, lastHolds: null, source };
  }

  const values = valid.map((p) => p.value);
  let maxGapHours = 0;
  for (let i = 1; i < valid.length; i++) {
    const gap = (Date.parse(valid[i].time) - Date.parse(valid[i - 1].time)) / 3_600_000;
    if (Number.isFinite(gap) && gap > maxGapHours) maxGapHours = gap;
  }

  const holding = valid.filter((p) => holds(claim.predicate, p.value, claim.threshold, claim.threshold2)).length;

  return {
    readings: valid.length,
    first: valid[0].time,
    last: valid[valid.length - 1].time,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    maxGapHours: Math.round(maxGapHours * 10) / 10,
    holdRate: holding / valid.length,
    lastHolds: holds(claim.predicate, valid[valid.length - 1].value, claim.threshold, claim.threshold2),
    lastValue: valid[valid.length - 1].value,
    source,
  };
}

/** Telemetry-window statistics for a numeric claim. */
function telemetryStats(claim: AdviceClaim): WindowStats {
  const column = METRIC_COLUMN[claim.metric];
  if (!column || !claim.hiveId) {
    return { readings: 0, first: null, last: null, min: null, max: null, avg: null, maxGapHours: 0, holdRate: null, lastHolds: null, source: 'none' };
  }
  const devices = deviceIdsForHive(claim.hiveId);
  if (devices.length === 0) {
    return { readings: 0, first: null, last: null, min: null, max: null, avg: null, maxGapHours: 0, holdRate: null, lastHolds: null, source: 'no-device' };
  }
  const placeholders = devices.map(() => '?').join(',');
  // Normalize on both sides: sensors store '47:12:C8', telemetry stores
  // '4712c8'. Comparing raw values returns zero rows and grades everything
  // 'unverifiable' — the failure is silent, so do it in SQL.
  const rows = db.prepare(`
    SELECT time, ${column} AS value
      FROM telemetry_cache
     WHERE lower(replace(deviceId, ':', '')) IN (${placeholders})
       AND time >= ? AND time <= ?
     ORDER BY time ASC
  `).all(...devices, claim.windowStart, claim.windowEnd) as { time: string; value: number | null }[];

  return summarize(claim, rows, 'telemetry_cache');
}

/** Inspection-weight statistics — weight is recorded per inspection, not per packet. */
function weightStats(claim: AdviceClaim): WindowStats {
  if (!claim.hiveId) {
    return { readings: 0, first: null, last: null, min: null, max: null, avg: null, maxGapHours: 0, holdRate: null, lastHolds: null, source: 'none' };
  }
  const rows = db.prepare(`
    SELECT date AS time, hiveWeight AS value
      FROM inspections
     WHERE hiveId = ? AND superseded_by IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date ASC
  `).all(claim.hiveId, claim.windowStart, claim.windowEnd) as { time: string; value: number | null }[];

  return summarize(claim, rows, 'inspections.hiveWeight');
}

// ─── Deterministic grading ──────────────────────────────────────────────────

export interface Verdict {
  claimId: string;
  grade: ClaimGrade;
  reason: string;
  observed: Record<string, unknown>;
  /** false when the verdict must not be persisted (provider was unreachable). */
  write?: boolean;
}

/**
 * Reduce window statistics to a verdict.
 *
 * 'unverifiable' is a first-class outcome and must stay that way. A claim the
 * sensors could not see is not a wrong call, and counting it as one would make
 * the beekeeper distrust a number that is actually honest.
 */
function verdictFromStats(claim: AdviceClaim, stats: WindowStats): Verdict {
  const observed = { ...stats, predicate: claim.predicate, threshold: claim.threshold, threshold2: claim.threshold2, basis: claim.basis, metric: claim.metric, unit: claim.unit };

  if (stats.readings === 0) {
    return {
      claimId: claim.id,
      grade: 'unverifiable',
      reason: `no ${claim.metric} readings in the window (${claim.windowStart.slice(0, 10)} → ${claim.windowEnd.slice(0, 10)}, source ${stats.source})`,
      observed,
    };
  }
  if (claim.metric === 'weight' && stats.readings < 1) {
    return { claimId: claim.id, grade: 'unverifiable', reason: 'no inspection weight recorded in the window', observed };
  }
  if (claim.metric !== 'weight' && stats.readings < MIN_READINGS) {
    return {
      claimId: claim.id,
      grade: 'unverifiable',
      reason: `only ${stats.readings} readings in the window (need ${MIN_READINGS})`,
      observed,
    };
  }
  if (claim.metric !== 'weight' && stats.maxGapHours > MAX_GAP_HOURS) {
    return {
      claimId: claim.id,
      grade: 'unverifiable',
      reason: `telemetry gap of ${stats.maxGapHours}h inside the window (max ${MAX_GAP_HOURS}h)`,
      observed,
    };
  }

  const range = `${fmt(claim.threshold)}${claim.threshold2 != null ? `–${fmt(claim.threshold2)}` : ''}${claim.unit ? claim.unit : ''}`;
  const actual = `min ${fmt(stats.min)}, max ${fmt(stats.max)}, avg ${fmt(stats.avg)}`;

  if (claim.basis === 'final') {
    const ok = stats.lastHolds === true;
    return {
      claimId: claim.id,
      grade: ok ? 'confirmed' : 'refuted',
      reason: ok
        ? `final ${claim.metric} ${fmt(stats.lastValue ?? null)}${claim.unit ?? ''} satisfies ${claim.predicate} ${range}`
        : `final ${claim.metric} ${fmt(stats.lastValue ?? null)}${claim.unit ?? ''} does not satisfy ${claim.predicate} ${range}`,
      observed,
    };
  }
  if (claim.basis === 'any') {
    const ok = (stats.holdRate ?? 0) > 0;
    return { claimId: claim.id, grade: ok ? 'confirmed' : 'refuted', reason: `${fmt((stats.holdRate ?? 0) * 100)}% of readings satisfied ${claim.predicate} ${range}`, observed };
  }
  if (claim.basis === 'all') {
    const ok = (stats.holdRate ?? 0) === 1;
    return { claimId: claim.id, grade: ok ? 'confirmed' : 'refuted', reason: `${fmt((stats.holdRate ?? 0) * 100)}% of readings satisfied ${claim.predicate} ${range} (required all)`, observed };
  }

  // majority
  const rate = stats.holdRate ?? 0;
  if (rate >= MAJORITY_CONFIRM) {
    return { claimId: claim.id, grade: 'confirmed', reason: `${fmt(rate * 100)}% of readings satisfied ${claim.predicate} ${range} (${actual})`, observed };
  }
  if (rate <= MAJORITY_REFUTE) {
    return { claimId: claim.id, grade: 'refuted', reason: `only ${fmt(rate * 100)}% of readings satisfied ${claim.predicate} ${range} (${actual})`, observed };
  }
  return { claimId: claim.id, grade: 'partial', reason: `${fmt(rate * 100)}% of readings satisfied ${claim.predicate} ${range} — ambiguous (${actual})`, observed };
}

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** Grade a numeric claim with no model call. */
export function gradeNumeric(claim: AdviceClaim): Verdict {
  const stats = claim.metric === 'weight' ? weightStats(claim) : telemetryStats(claim);
  return verdictFromStats(claim, stats);
}

// ─── Observation grading (batched model call) ───────────────────────────────

interface EvidencePacket {
  claimId: string;
  hive: string;
  claim: string;
  advice: string;
  window: string;
  inspections: unknown[];
  feedings: unknown[];
  tasksCompleted: string[];
  alerts: string[];
  sensors: { readings: number; min: number | null; max: number | null; avg: number | null; gaps: number };
}

/** Evidence in the window. Deliberately excludes rationale and confidence. */
function observationEvidence(claim: AdviceClaim): EvidencePacket {
  const inspections = claim.hiveId
    ? db.prepare(`
        SELECT date, queenPresent, queenCells, cappedBrood, healthStatus,
               populationSize, honeyStores, temperament, substr(notes, 1, 500) AS notes
          FROM inspections
         WHERE hiveId = ? AND superseded_by IS NULL
           AND date >= ? AND date <= ?
         ORDER BY date ASC
         LIMIT 10
      `).all(claim.hiveId, claim.windowStart, claim.windowEnd)
    : [];

  let feedings: unknown[] = [];
  if (claim.hiveId) {
    try {
      feedings = db.prepare(`
        SELECT date AS timestamp, feedType, amount, note FROM feeding_events
         WHERE hiveId = ? AND date >= ? AND date <= ?
         ORDER BY date ASC LIMIT 10
      `).all(claim.hiveId, claim.windowStart, claim.windowEnd);
    } catch { /* feeding_events table absent on an old DB — evidence is optional */ }
  }

  const tasksCompleted = claim.hiveId
    ? (db.prepare(`
        SELECT title FROM tasks
         WHERE hiveId = ? AND superseded_by IS NULL AND completed = 1
         ORDER BY dueDate ASC LIMIT 10
      `).all(claim.hiveId) as { title: string }[]).map((t) => t.title)
    : [];

  const alerts = claim.hiveId
    ? (db.prepare(`
        SELECT title FROM agentic_log
         WHERE hiveId = ? AND severity IN ('warning', 'urgent')
           AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC LIMIT 10
      `).all(claim.hiveId, claim.windowStart, claim.windowEnd) as { title: string }[]).map((t) => t.title)
    : [];

  const stats = telemetryStats({ ...claim, metric: 'temperature', predicate: 'lt', threshold: 0 });

  return {
    claimId: claim.id,
    hive: claim.hiveName ?? claim.hiveId ?? 'apiary',
    claim: claim.claim,
    advice: claim.advice,
    window: `${claim.windowStart.slice(0, 10)} → ${claim.windowEnd.slice(0, 10)}`,
    inspections,
    feedings,
    tasksCompleted,
    alerts,
    sensors: { readings: stats.readings, min: stats.min, max: stats.max, avg: stats.avg, gaps: stats.maxGapHours },
  };
}

const GRADER_SYSTEM = `You are an auditing grader for a beekeeping assistant. You receive a list of claims the assistant made, plus the evidence recorded in each claim's test window. For each claim, decide whether the evidence confirms or refutes it.

Rules:
- Output ONLY a JSON array. No prose, no code fences.
- One object per input claim: {"claimId": string, "grade": "confirmed"|"refuted"|"partial"|"unverifiable", "reason": string}
- "confirmed" = the evidence clearly supports the claim.
- "refuted" = the evidence clearly contradicts it.
- "partial" = some support, some contradiction, or the claim is only partly borne out.
- "unverifiable" = the evidence does not speak to the claim at all, or there is no evidence. Prefer this over guessing. Counting an unseen claim as wrong is worse than admitting you cannot tell.
- A missing inspection or a silent sensor is NOT evidence of absence. Do not refute a claim merely because nothing was recorded.
- Reason: one sentence, max 160 chars, cite the specific evidence you used.
- Judge only against the evidence given. You do not have the assistant's reasoning, and you should not invent it.`;

async function gradeObservations(claims: AdviceClaim[]): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];

  for (let i = 0; i < claims.length; i += BATCH_SIZE) {
    const batch = claims.slice(i, i + BATCH_SIZE);
    const packets = batch.map(observationEvidence);
    const started = Date.now();

    let raw = '';
    try {
      const resp = await fetch(GRADER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GRADER_KEY}` },
        body: JSON.stringify({
          model: GRADER_MODEL,
          stream: false,
          temperature: 0,
          messages: [
            { role: 'system', content: GRADER_SYSTEM },
            { role: 'user', content: JSON.stringify(packets) },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`grader ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
      const data = await resp.json() as any;
      raw = data.choices?.[0]?.message?.content ?? '';
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'grader call failed';
      // A provider outage must not poison the ledger. Leave the claims open;
      // the next run picks them up.
      console.error(`[adviceGrader] ${msg} — leaving ${batch.length} claim(s) open`);
      for (const c of batch) {
        verdicts.push({
          claimId: c.id,
          grade: 'unverifiable',
          reason: `grader unavailable: ${msg.slice(0, 80)}`,
          observed: { error: msg },
          write: false,
        });
      }
      continue;
    }

    const parsed = parseVerdicts(raw);
    for (const claim of batch) {
      const v = parsed.get(claim.id);
      const observed = packets.find((p) => p.claimId === claim.id) ?? {};
      if (!v) {
        verdicts.push({ claimId: claim.id, grade: 'unverifiable', reason: 'grader returned no verdict for this claim', observed });
        continue;
      }
      verdicts.push({ claimId: claim.id, grade: v.grade, reason: v.reason, observed: { ...observed, latencyMs: Date.now() - started } });
    }
  }

  return verdicts;
}

/** Tolerant JSON extraction — a model that wraps its array in prose still grades. */
export function parseVerdicts(raw: string): Map<string, { grade: ClaimGrade; reason: string }> {
  const out = new Map<string, { grade: ClaimGrade; reason: string }>();
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return out;

  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(arr)) return out;

  const allowed: ClaimGrade[] = ['confirmed', 'refuted', 'partial', 'unverifiable'];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.claimId === 'string' ? rec.claimId : null;
    const grade = typeof rec.grade === 'string' ? rec.grade.toLowerCase() : '';
    if (!id || !allowed.includes(grade as ClaimGrade)) continue;
    out.set(id, {
      grade: grade as ClaimGrade,
      reason: typeof rec.reason === 'string' ? rec.reason.slice(0, 240) : '',
    });
  }
  return out;
}

// ─── The loop ───────────────────────────────────────────────────────────────

export interface GradeRunOptions {
  dryRun?: boolean;
  limit?: number;
  /** Grade one specific claim regardless of due state (for testing a schema change). */
  claimId?: string;
}

export interface GradeRunResult {
  considered: number;
  numeric: number;
  observation: number;
  written: number;
  byGrade: Record<string, number>;
  verdicts: Verdict[];
}

/**
 * One pass of the grading loop. Idempotent: a graded claim leaves 'open' and is
 * not reconsidered, so a double-run cannot double-count the accuracy number.
 */
export async function gradeDue(opts: GradeRunOptions = {}): Promise<GradeRunResult> {
  const claims = opts.claimId
    ? [getClaim(opts.claimId)].filter((c): c is AdviceClaim => !!c)
    : dueClaims(now(), opts.limit ?? 200);

  const numericClaims = claims.filter((c) => NUMERIC_METRICS.has(c.metric));
  const observationClaims = claims.filter((c) => !NUMERIC_METRICS.has(c.metric));

  const verdicts: Verdict[] = [
    ...numericClaims.map((c) => gradeNumeric(c)),
    ...(await gradeObservations(observationClaims)),
  ];

  const byGrade: Record<string, number> = {};
  let written = 0;

  for (const v of verdicts) {
    byGrade[v.grade] = (byGrade[v.grade] ?? 0) + 1;
    if (opts.dryRun || v.write === false) continue;

    const claim = claims.find((c) => c.id === v.claimId);
    recordGrade({
      claimId: v.claimId,
      grader: NUMERIC_METRICS.has(claim?.metric ?? '') ? 'deterministic' : `llm:${GRADER_MODEL}`,
      grade: v.grade,
      reason: v.reason,
      observed: v.observed,
      model: NUMERIC_METRICS.has(claim?.metric ?? '') ? null : GRADER_MODEL,
      latencyMs: typeof v.observed?.latencyMs === 'number' ? (v.observed.latencyMs as number) : null,
    });
    written++;

    logAgenticEvent({
      type: 'claim-grade',
      source: 'advice-grader',
      title: `${v.grade}: ${claim?.claim.slice(0, 80) ?? v.claimId}`,
      body: v.reason,
      hiveId: claim?.hiveId ?? null,
      hiveName: claim?.hiveName ?? null,
      severity: v.grade === 'refuted' ? 'warning' : 'info',
      metadata: { claimId: v.claimId, grade: v.grade, basis: claim?.metric ?? null },
    });
  }

  return {
    considered: claims.length,
    numeric: numericClaims.length,
    observation: observationClaims.length,
    written,
    byGrade,
    verdicts,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.indexOf('--limit');
  const claimArg = argv.indexOf('--claim');
  const limit = limitArg !== -1 ? Number(argv[limitArg + 1]) : undefined;
  const claimId = claimArg !== -1 ? argv[claimArg + 1] : undefined;

  const result = await gradeDue({ dryRun, limit, claimId });

  console.log(`[adviceGrader]${dryRun ? ' (dry run)' : ''} considered ${result.considered} — ` +
    `${result.numeric} numeric, ${result.observation} observation — wrote ${result.written}`);

  for (const v of result.verdicts) {
    const claim = getClaim(v.claimId);
    console.log(`\n  ${v.grade.toUpperCase().padEnd(13)} ${v.claimId}  [${claim?.metric ?? '?'}]`);
    console.log(`    claim:  ${claim?.claim ?? ''}`);
    console.log(`    reason: ${v.reason}`);
  }

  if (Object.keys(result.byGrade).length > 0) {
    console.log('\n  ' + Object.entries(result.byGrade).map(([g, n]) => `${g}=${n}`).join('  '));
  }
  if (result.considered === 0) console.log('  nothing due — no claims past their window');
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error('[adviceGrader] failed:', e);
    process.exit(1);
  });
}
