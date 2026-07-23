// server/feeding.ts — Feeding event tracking + syrup refill prediction
// Tracks Apimaye feeder fills, estimates consumption, and predicts when
// to refill based on colony size + box count + frame size + season.
//
// Self-calibrating: when Mark logs a refill with "was empty" or "half left",
// we compare actual consumption to our estimate and adjust per-hive calibration.

import { db, genId } from './db.js';
import { estimateConsumptionRate, syrupTypeForSeason } from './weightTracking.js';

export type RefillState = 'empty' | 'partial' | 'full' | null;

export interface FeedingEvent {
  id: string;
  hiveId: string;
  date: string;
  feedType: string;
  amount: number;
  feederType: string;
  note: string;
  refillState: RefillState;
  remainingAmount: number | null;
  daysSinceFill: number | null;
}

export interface CalibrationFactor {
  hiveId: string;
  hiveName: string;
  factor: number;       // multiplier applied to base estimate (1.0 = no adjustment)
  sampleCount: number;  // how many refill observations
  lastCalibratedAt: string | null;
  commentary: string;
}

export interface FeedingStatus {
  hiveId: string;
  hiveName: string;
  lastFeeding: FeedingEvent | null;
  daysSinceLastFeeding: number | null;
  estimatedConsumptionRate: number; // mL/day (calibrated)
  estimatedDaysUntilEmpty: number | null;
  recommendedFeedType: { type: string; ratio: string; reason: string };
  calibration: CalibrationFactor;
  alert: string | null;
  history: FeedingEvent[];
}

interface HiveRow {
  entity_id: string;
  name: string;
}

interface InspectionRow {
  populationSize: string;
  date: string;
}

/** Apimaye integrated inner cover feeder capacity (mL). Used for refill estimation UI. */
const _APIMAYE_CAPACITY_ML = 1500;

/** Record a feeding event, optionally with refill calibration data. */
export function recordFeeding(params: {
  hiveId: string;
  date?: string;
  feedType: string;
  amount: number;
  feederType?: string;
  note?: string;
  refillState?: RefillState;
  remainingAmount?: number | null;
}): FeedingEvent {
  const { hiveId, feedType, amount } = params;
  const id = genId('feed');
  const date = params.date ?? new Date().toISOString();
  const feederType = params.feederType ?? 'apimaye-inner-cover';
  const note = params.note ?? '';
  const refillState = params.refillState ?? null;
  const remainingAmount = params.remainingAmount ?? null;

  // Auto-compute days since previous fill
  let daysSinceFill: number | null = null;
  const prev = db
    .prepare('SELECT date FROM feeding_events WHERE hiveId = ? ORDER BY date DESC LIMIT 1')
    .get(hiveId) as { date: string } | undefined;
  if (prev) {
    daysSinceFill = Math.floor((new Date(date).getTime() - new Date(prev.date).getTime()) / (1000 * 60 * 60 * 24));
  }

  db.prepare(
    `INSERT INTO feeding_events (id, hiveId, date, feedType, amount, feederType, note, refillState, remainingAmount, daysSinceFill, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, hiveId, date, feedType, amount, feederType, note, refillState, remainingAmount, daysSinceFill, new Date().toISOString());

  return { id, hiveId, date, feedType, amount, feederType, note, refillState, remainingAmount, daysSinceFill };
}

/** Compute per-hive calibration factor from refill observations.
 * Compares actual consumption (amount - remaining) / days vs estimated rate.
 * Returns a multiplier to apply to the base estimate. */
export function getCalibrationFactor(hiveId: string): CalibrationFactor {
  const hive = db.prepare('SELECT entity_id, name FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId) as HiveRow | undefined;
  const hiveName = hive?.name ?? hiveId;

  // Find all refill events (where refillState is not null and daysSinceFill > 0)
  const refills = db
    .prepare(`SELECT * FROM feeding_events
              WHERE hiveId = ? AND refillState IS NOT NULL AND daysSinceFill IS NOT NULL AND daysSinceFill > 0
              ORDER BY date ASC`)
    .all(hiveId) as any[];

  if (refills.length === 0) {
    return {
      hiveId,
      hiveName,
      factor: 1.0,
      sampleCount: 0,
      lastCalibratedAt: null,
      commentary: `${hiveName}: no refill calibration data yet. Estimates are based on colony size + season averages. Log a refill with "empty" or "half left" to start calibrating.`,
    };
  }

  // For each refill, compute actual consumption rate vs estimated
  // Actual rate = (original amount - remaining) / days
  // But we don't know the original amount perfectly — use the amount from the
  // PREVIOUS fill, not the refill itself.
  const ratios: number[] = [];

  for (let i = 0; i < refills.length; i++) {
    const refill = refills[i];
    // Find the previous fill for this hive
    const prevFill = db
      .prepare(`SELECT amount FROM feeding_events WHERE hiveId = ? AND date < ? ORDER BY date DESC LIMIT 1`)
      .get(hiveId, refill.date) as { amount: number } | undefined;

    if (!prevFill) continue;

    const originalAmount = prevFill.amount;
    const remaining = refill.remainingAmount ?? (refill.refillState === 'empty' ? 0 : refill.refillState === 'full' ? originalAmount : 0);
    const consumed = originalAmount - remaining;
    const days = refill.daysSinceFill;

    if (consumed <= 0 || days <= 0) continue;

    const actualRatePerDay = consumed / days;

    // Estimate what we would have predicted
    // We need the population + season at the time of the previous fill
    const prevDate = new Date(refill.date);
    prevDate.setDate(prevDate.getDate() - days);
    const lastInsp = db
      .prepare('SELECT populationSize FROM inspections WHERE hiveId = ? AND superseded_by IS NULL AND date <= ? ORDER BY date DESC LIMIT 1')
      .get(hiveId, refill.date) as { populationSize: string } | undefined;
    const popSize = lastInsp?.populationSize ?? 'average';
    const month = prevDate.getMonth();

    // Get box count at that time (current is best we have)
    const boxes = db.prepare('SELECT type FROM boxes WHERE hiveId = ? AND superseded_by IS NULL').all(hiveId) as { type: string }[];
    const boxCount = boxes.length;
    const frameType = boxes[0]?.type ?? 'deep';

    const estimatedRate = estimateConsumptionRate(popSize, month, boxCount, frameType);
    if (estimatedRate > 0) {
      const ratio = actualRatePerDay / estimatedRate;
      // Clamp to reasonable range (0.1x to 5x)
      ratios.push(Math.max(0.1, Math.min(5.0, ratio)));
    }
  }

  if (ratios.length === 0) {
    return {
      hiveId,
      hiveName,
      factor: 1.0,
      sampleCount: 0,
      lastCalibratedAt: null,
      commentary: `${hiveName}: refill data exists but not enough to calibrate. Keep logging refills.`,
    };
  }

  // Use exponential moving average — weight recent observations more
  // This adapts as colony grows or seasons shift
  let ema = ratios[0];
  const alpha = 0.4; // smoothing factor
  for (let i = 1; i < ratios.length; i++) {
    ema = alpha * ratios[i] + (1 - alpha) * ema;
  }
  // Clamp final factor
  const factor = Math.max(0.2, Math.min(3.0, ema));
  const lastRefill = refills[refills.length - 1];

  const trend = factor > 1.2 ? 'drinking faster than expected' : factor < 0.8 ? 'drinking slower than expected' : 'matching estimates';

  return {
    hiveId,
    hiveName,
    factor: Math.round(factor * 100) / 100,
    sampleCount: ratios.length,
    lastCalibratedAt: lastRefill.date,
    commentary: `${hiveName}: calibrated to ${factor.toFixed(2)}x base rate (${trend}, ${ratios.length} observation${ratios.length !== 1 ? 's' : ''}).`,
  };
}

/** Get feeding status for a single hive. */
export function getFeedingStatus(hiveId: string): FeedingStatus {
  const hive = db.prepare('SELECT entity_id, name FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId) as HiveRow | undefined;
  const hiveName = hive?.name ?? hiveId;

  // Get feeding history
  const rows = db
    .prepare('SELECT * FROM feeding_events WHERE hiveId = ? ORDER BY date DESC')
    .all(hiveId) as any[];

  const history: FeedingEvent[] = rows.map((r) => ({
    id: r.id,
    hiveId: r.hiveId,
    date: r.date,
    feedType: r.feedType,
    amount: r.amount,
    feederType: r.feederType,
    note: r.note ?? '',
    refillState: r.refillState ?? null,
    remainingAmount: r.remainingAmount ?? null,
    daysSinceFill: r.daysSinceFill ?? null,
  }));

  const lastFeeding = history[0] ?? null;
  const daysSinceLastFeeding = lastFeeding
    ? Math.floor((Date.now() - new Date(lastFeeding.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Get latest inspection for population size
  const lastInspection = db
    .prepare('SELECT populationSize, date FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC LIMIT 1')
    .all(hiveId) as InspectionRow[];

  const populationSize = lastInspection[0]?.populationSize ?? 'average';
  const month = new Date().getMonth();

  // Get box count + frame type for colony size estimation
  const boxes = db
    .prepare('SELECT type FROM boxes WHERE hiveId = ? AND superseded_by IS NULL')
    .all(hiveId) as { type: string }[];
  const boxCount = boxes.length;
  const frameType = boxes[0]?.type ?? 'deep';

  // Base estimate from model
  const baseRate = estimateConsumptionRate(populationSize, month, boxCount, frameType);

  // Apply per-hive calibration
  const calibration = getCalibrationFactor(hiveId);
  const calibratedRate = Math.round(baseRate * calibration.factor);

  // Estimate days until feeder empty (only for syrup in Apimaye)
  let estimatedDaysUntilEmpty: number | null = null;
  if (lastFeeding && lastFeeding.feedType.startsWith('syrup') && lastFeeding.feederType === 'apimaye-inner-cover') {
    if (calibratedRate > 0) {
      // If last feeding had a refill state, start from remaining amount
      const startingAmount = lastFeeding.remainingAmount != null ? lastFeeding.remainingAmount + lastFeeding.amount : lastFeeding.amount;
      estimatedDaysUntilEmpty = Math.floor(startingAmount / calibratedRate);
    }
  }

  const recommendedFeed = syrupTypeForSeason();

  // Generate alert — calibrated timing
  let alert: string | null = null;
  if (lastFeeding && lastFeeding.feederType === 'apimaye-inner-cover' && estimatedDaysUntilEmpty !== null) {
    const daysSince = daysSinceLastFeeding ?? 0;
    const daysRemaining = estimatedDaysUntilEmpty - daysSince;
    if (daysRemaining <= 0) {
      alert = `${hiveName} syrup feeder likely empty (was filled ${daysSince}d ago, estimated ${estimatedDaysUntilEmpty}d supply). Refill with ${recommendedFeed.ratio} ${recommendedFeed.type}. ${recommendedFeed.reason}`;
    } else if (daysRemaining <= 2) {
      alert = `${hiveName} syrup feeder will need refill in ~${daysRemaining}d. Next: ${recommendedFeed.ratio} ${recommendedFeed.type}.`;
    } else if (daysRemaining <= 5) {
      alert = `${hiveName} syrup feeder has ~${daysRemaining}d supply left.`;
    }
  } else if (!lastFeeding && populationSize !== 'none') {
    if (month === 2 || month === 3 || month === 8 || month === 9) {
      alert = `${hiveName} has no feeding record. Consider feeding ${recommendedFeed.ratio} ${recommendedFeed.type}. ${recommendedFeed.reason}`;
    }
  }

  return {
    hiveId,
    hiveName,
    lastFeeding,
    daysSinceLastFeeding,
    estimatedConsumptionRate: calibratedRate,
    estimatedDaysUntilEmpty,
    recommendedFeedType: recommendedFeed,
    calibration,
    alert,
    history: history.slice(0, 10),
  };
}

/** Get feeding status for all hives. */
export function getAllFeedingStatuses(): FeedingStatus[] {
  const hives = db.prepare('SELECT entity_id FROM hives WHERE superseded_by IS NULL').all() as { entity_id: string }[];
  return hives.map((h) => getFeedingStatus(h.entity_id));
}

/** Get all feeding events (for history/export). */
export function getAllFeedingEvents(): FeedingEvent[] {
  const rows = db.prepare('SELECT * FROM feeding_events ORDER BY date DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    hiveId: r.hiveId,
    date: r.date,
    feedType: r.feedType,
    amount: r.amount,
    feederType: r.feederType,
    note: r.note ?? '',
    refillState: r.refillState ?? null,
    remainingAmount: r.remainingAmount ?? null,
    daysSinceFill: r.daysSinceFill ?? null,
  }));
}