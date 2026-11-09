// server/adviceClaims.ts — the advice ledger.
//
// agentic_log records what the agent DID. This records what the agent BELIEVED:
// one row per piece of advice, carrying a falsifiable claim and the window in
// which it can be tested. server/adviceGrader.ts is the other half — it wakes up
// after window_end, reads what actually happened, and writes a verdict.
//
// Why this exists: without a ledger, every piece of BeeTree advice is
// unfalsifiable. The assistant can be confidently wrong forever and nothing in
// the system would notice. With it, advice becomes the eval set — real
// predictions against real hives, which is also the honest accuracy number the
// dashboard can show the beekeeper.
//
// Naming: `hiveId` here is a hive entity_id, matching every other table.

import { db, genId, now } from './db.js';

export type ClaimMetric =
  | 'temperature' | 'humidity' | 'weight' | 'battery'
  | 'inspection' | 'observation';

export type ClaimPredicate = 'lt' | 'gt' | 'between' | 'observed' | 'absent';
export type ClaimBasis = 'majority' | 'final' | 'any' | 'all';
export type ClaimGrade = 'confirmed' | 'refuted' | 'partial' | 'unverifiable';
export type ClaimStatus = 'open' | 'graded' | 'void';

/** Metrics graded in SQL against telemetry_cache — no model call. */
export const NUMERIC_METRICS: ReadonlySet<string> = new Set([
  'temperature', 'humidity', 'weight', 'battery',
]);

export interface AdviceClaim {
  id: string;
  hiveId: string | null;
  hiveName: string | null;
  source: string;
  chatMessageId: string | null;
  taskId: string | null;
  advice: string;
  claim: string;
  metric: ClaimMetric;
  predicate: ClaimPredicate;
  threshold: number | null;
  threshold2: number | null;
  unit: string | null;
  basis: ClaimBasis;
  windowStart: string;
  windowEnd: string;
  toleranceDays: number;
  confidence: number | null;
  rationale: string | null;
  status: ClaimStatus;
  createdAt: string;
  gradedAt: string | null;
  grade: ClaimGrade | null;
  gradeReason: string | null;
  gradeBasis: string | null;
  voidReason: string | null;
}

const SELECT = `
  SELECT id, hiveId, hiveName, source, chatMessageId, taskId, advice, claim,
         metric, predicate, threshold, threshold2, unit, basis,
         window_start AS windowStart, window_end AS windowEnd,
         tolerance_days AS toleranceDays, confidence, rationale,
         status, createdAt, gradedAt, grade, gradeReason, gradeBasis, voidReason
  FROM advice_claims
`;

export interface CreateClaimInput {
  hiveId?: string | null;
  hiveName?: string | null;
  source: string;
  chatMessageId?: string | null;
  taskId?: string | null;
  advice: string;
  claim: string;
  metric: ClaimMetric;
  predicate?: ClaimPredicate;
  threshold?: number | null;
  threshold2?: number | null;
  unit?: string | null;
  basis?: ClaimBasis;
  /** ISO. Defaults to the claim's own creation time. */
  windowStart?: string;
  /** ISO. Required — a claim with no test date can never be graded. */
  windowEnd: string;
  toleranceDays?: number;
  confidence?: number | null;
  rationale?: string | null;
}

/** Thrown when a claim is not gradeable. Callers surface `.message` as a tool error. */
export class ClaimValidationError extends Error {}

/**
 * Validate a claim before it enters the ledger.
 *
 * The rule that matters: a numeric predicate with no threshold can never be
 * graded, so it is rejected at write time rather than sitting in the ledger
 * forever and inflating the open count. Same for a window that has already
 * closed, and for window_end <= window_start.
 */
export function validateClaim(input: CreateClaimInput): void {
  if (!input.claim?.trim()) throw new ClaimValidationError('claim is required');
  if (!input.advice?.trim()) throw new ClaimValidationError('advice is required');
  if (!input.source?.trim()) throw new ClaimValidationError('source is required');
  if (!input.windowEnd) throw new ClaimValidationError('windowEnd is required');

  const end = Date.parse(input.windowEnd);
  if (Number.isNaN(end)) throw new ClaimValidationError(`windowEnd is not a valid ISO timestamp: ${input.windowEnd}`);

  const start = input.windowStart ? Date.parse(input.windowStart) : Date.now();
  if (Number.isNaN(start)) throw new ClaimValidationError(`windowStart is not a valid ISO timestamp: ${input.windowStart}`);
  if (end <= start) throw new ClaimValidationError('windowEnd must be after windowStart');

  const predicate = input.predicate ?? (NUMERIC_METRICS.has(input.metric) ? 'lt' : 'observed');
  if (predicate === 'lt' || predicate === 'gt') {
    if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold)) {
      throw new ClaimValidationError(`metric '${input.metric}' with predicate '${predicate}' needs a numeric threshold`);
    }
  }
  if (predicate === 'between') {
    if (typeof input.threshold !== 'number' || typeof input.threshold2 !== 'number') {
      throw new ClaimValidationError("predicate 'between' needs both threshold and threshold2");
    }
    if (input.threshold >= input.threshold2) {
      throw new ClaimValidationError('threshold must be below threshold2 for predicate "between"');
    }
  }
  if (input.toleranceDays != null && (input.toleranceDays < 0 || input.toleranceDays > 60)) {
    throw new ClaimValidationError('toleranceDays must be between 0 and 60');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new ClaimValidationError('confidence must be between 0 and 1');
  }
}

/** Record a claim. Returns the stored row. */
export function createClaim(input: CreateClaimInput): AdviceClaim {
  validateClaim(input);

  const id = genId('claim');
  const createdAt = now();
  const predicate: ClaimPredicate =
    input.predicate ?? (NUMERIC_METRICS.has(input.metric) ? 'lt' : 'observed');

  // Default basis: a threshold on a single reading is about the state at the
  // end of the window ("has it come back down?"), while a presence claim is
  // about whether it happened at all. Guessing 'majority' for both would make
  // "queen cells will appear" refutable by never appearing in most readings.
  const basis: ClaimBasis =
    input.basis ?? (NUMERIC_METRICS.has(input.metric) ? 'final' : 'any');

  db.prepare(`
    INSERT INTO advice_claims (
      id, hiveId, hiveName, source, chatMessageId, taskId, advice, claim,
      metric, predicate, threshold, threshold2, unit, basis,
      window_start, window_end, tolerance_days, confidence, rationale,
      status, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(
    id,
    input.hiveId ?? null,
    input.hiveName ?? null,
    input.source,
    input.chatMessageId ?? null,
    input.taskId ?? null,
    input.advice.trim(),
    input.claim.trim(),
    input.metric,
    predicate,
    input.threshold ?? null,
    input.threshold2 ?? null,
    input.unit ?? null,
    basis,
    input.windowStart ?? createdAt,
    input.windowEnd,
    input.toleranceDays ?? 1,
    input.confidence ?? null,
    input.rationale ?? null,
    createdAt,
  );

  return getClaim(id)!;
}

export function getClaim(id: string): AdviceClaim | null {
  return (db.prepare(`${SELECT} WHERE id = ?`).get(id) as AdviceClaim | undefined) ?? null;
}

export interface ListClaimsOptions {
  status?: ClaimStatus;
  hiveId?: string;
  source?: string;
  grade?: ClaimGrade;
  limit?: number;
  offset?: number;
}

export function listClaims(opts: ListClaimsOptions = {}): AdviceClaim[] {
  const where: string[] = [];
  const args: any[] = [];
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  if (opts.hiveId) { where.push('hiveId = ?'); args.push(opts.hiveId); }
  if (opts.source) { where.push('source = ?'); args.push(opts.source); }
  if (opts.grade) { where.push('grade = ?'); args.push(opts.grade); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  return db.prepare(`${SELECT} ${clause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as AdviceClaim[];
}

/**
 * Claims whose window has closed (plus tolerance) and are still ungraded.
 *
 * tolerance_days absorbs telemetry lag — grading on the exact hour a window
 * closes grades on a gap, which produces an unverifiable verdict for a claim
 * that was perfectly checkable a day later.
 */
export function dueClaims(nowIso: string = now(), limit = 200): AdviceClaim[] {
  return db.prepare(`
    ${SELECT}
    WHERE status = 'open'
      AND datetime(window_end, '+' || tolerance_days || ' days') <= datetime(?)
    ORDER BY window_end ASC
    LIMIT ?
  `).all(nowIso, limit) as AdviceClaim[];
}

export interface RecordGradeInput {
  claimId: string;
  grader: string;
  grade: ClaimGrade;
  reason?: string;
  /** JSON-serializable evidence packet the verdict was based on. */
  observed?: unknown;
  model?: string | null;
  latencyMs?: number | null;
}

/**
 * Record a verdict. Appends to the audit trail and mirrors it onto the claim.
 *
 * Append-only by design: a re-grade after a model change, or a human override,
 * adds a row rather than rewriting one. The claim's own `grade` column is a
 * cache of the newest row, so a dashboard read costs one query.
 */
export function recordGrade(input: RecordGradeInput): void {
  const claim = getClaim(input.claimId);
  if (!claim) throw new ClaimValidationError(`unknown claim: ${input.claimId}`);

  const gradedAt = now();
  const observedJson = JSON.stringify(input.observed ?? {});

  const write = db.transaction(() => {
    db.prepare(`
      INSERT INTO advice_claim_grades (id, claimId, gradedAt, grader, grade, reason, observed, model, latencyMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      genId('grade'),
      input.claimId,
      gradedAt,
      input.grader,
      input.grade,
      input.reason ?? '',
      observedJson,
      input.model ?? null,
      input.latencyMs ?? null,
    );

    db.prepare(`
      UPDATE advice_claims
         SET status = 'graded', gradedAt = ?, grade = ?, gradeReason = ?, gradeBasis = ?
       WHERE id = ?
    `).run(
      gradedAt,
      input.grade,
      input.reason ?? '',
      input.grader.split(':')[0],
      input.claimId,
    );
  });
  write();
}

/** Withdraw a claim without grading it (advice was superseded, hive died, etc.). */
export function voidClaim(claimId: string, reason: string): void {
  const claim = getClaim(claimId);
  if (!claim) throw new ClaimValidationError(`unknown claim: ${claimId}`);
  db.prepare(`
    UPDATE advice_claims
       SET status = 'void', voidReason = ?
     WHERE id = ? AND status = 'open'
  `).run(reason, claimId);
}

export interface AccuracySummary {
  total: number;
  open: number;
  void: number;
  confirmed: number;
  refuted: number;
  partial: number;
  unverifiable: number;
  /** confirmed / (confirmed + refuted + partial). null when nothing is graded. */
  accuracy: number | null;
  /** confirmed / (confirmed + refuted). Excludes the ambiguous middle. */
  strictAccuracy: number | null;
  /** Confidence buckets vs realised outcome — the calibration curve. */
  calibration: { bucket: string; n: number; confirmed: number; rate: number | null }[];
}

/**
 * The number the dashboard shows the beekeeper: "BeeTree's calls this season."
 *
 * accuracy double-counts nothing, but a claim can be re-graded; only the newest
 * verdict per claim is used, which is why this reads advice_claims and not the
 * grades table.
 */
export function accuracySummary(since?: string): AccuracySummary {
  const clause = since ? 'WHERE createdAt >= ?' : '';
  const args = since ? [since] : [];

  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'open') AS open,
      SUM(status = 'void') AS void,
      SUM(grade = 'confirmed') AS confirmed,
      SUM(grade = 'refuted') AS refuted,
      SUM(grade = 'partial') AS partial,
      SUM(grade = 'unverifiable') AS unverifiable
    FROM advice_claims ${clause}
  `).get(...args) as any;

  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const confirmed = n(counts?.confirmed);
  const refuted = n(counts?.refuted);
  const partial = n(counts?.partial);
  const decided = confirmed + refuted + partial;

  const rows = db.prepare(`
    SELECT confidence, grade FROM advice_claims
    ${clause ? clause + ' AND' : 'WHERE'} confidence IS NOT NULL
      AND grade IN ('confirmed', 'refuted')
  `).all(...args) as { confidence: number; grade: string }[];

  const buckets = new Map<string, { n: number; confirmed: number }>();
  for (const b of ['0.0-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0']) buckets.set(b, { n: 0, confirmed: 0 });
  for (const r of rows) {
    const c = Math.max(0, Math.min(1, r.confidence));
    const label = c < 0.4 ? '0.0-0.4' : c < 0.6 ? '0.4-0.6' : c < 0.8 ? '0.6-0.8' : '0.8-1.0';
    const bucket = buckets.get(label)!;
    bucket.n += 1;
    if (r.grade === 'confirmed') bucket.confirmed += 1;
  }

  return {
    total: n(counts?.total),
    open: n(counts?.open),
    void: n(counts?.void),
    confirmed,
    refuted,
    partial,
    unverifiable: n(counts?.unverifiable),
    accuracy: decided > 0 ? confirmed / decided : null,
    strictAccuracy: confirmed + refuted > 0 ? confirmed / (confirmed + refuted) : null,
    calibration: [...buckets.entries()].map(([bucket, v]) => ({
      bucket,
      n: v.n,
      confirmed: v.confirmed,
      rate: v.n > 0 ? v.confirmed / v.n : null,
    })),
  };
}
