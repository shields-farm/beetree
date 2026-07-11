// server/weightTracking.ts — Hive weight trend analysis from inspection history
// Detects declining weight (starvation risk, absconding, robbing) and
// seasonal threshold violations.

import { db } from './db.js';

export interface WeightEntry {
  inspectionId: string;
  date: string;
  weight: number;
}

export interface WeightTrend {
  hiveId: string;
  hiveName: string;
  entries: WeightEntry[];
  currentWeight: number | null;
  previousWeight: number | null;
  trend: 'gaining' | 'stable' | 'declining' | 'no-data';
  totalChange: number; // current - first
  ratePerWeek: number; // lbs per week
  threshold: number; // seasonal minimum
  belowThreshold: boolean;
  alert: string | null;
  commentary: string;
}

interface HiveRow {
  entity_id: string;
  name: string;
}

interface InspectionRow {
  entity_id: string;
  hiveId: string;
  date: string;
  hiveWeight: number;
}

/** Seasonal weight thresholds (lbs) for Georgia.
 * These are "danger" floors — below this, the colony likely doesn't have
 * enough stores and needs immediate feeding. */
function seasonalThreshold(date: Date): number {
  const m = date.getMonth();
  // Winter (Dec-Feb): bees need 30+ lbs of honey to survive
  if (m === 11 || m <= 1) return 30;
  // Fall (Sep-Nov): building winter stores, should be 40+ by Nov
  if (m >= 8 && m <= 10) return 35;
  // Spring buildup (Mar-May): can be lower, flow is starting
  if (m >= 2 && m <= 4) return 15;
  // Summer (Jun-Aug): dearth risk but colonies are large, 20 lbs floor
  return 20;
}

/** Syrup type recommendation by season for Georgia. */
export function syrupTypeForSeason(date?: Date): { type: string; ratio: string; reason: string } {
  const d = date ?? new Date();
  const m = d.getMonth();
  if (m === 11 || m <= 1) {
    return { type: 'fondant', ratio: 'solid', reason: 'Winter — fondant or candy board. Bees can\'t take syrup when temps are below 50°F. Use HiveAlive Fondant Food Supplement or Mountain Camp method.' };
  }
  if (m === 2 || m === 3) {
    return { type: 'syrup-1:1', ratio: '1:1', reason: 'Early spring — 1:1 syrup stimulates brood rearing and mimics nectar flow. Use Apimaye integrated inner cover feeder.' };
  }
  if (m === 4 || m === 5) {
    return { type: 'none', ratio: '—', reason: 'Main nectar flow (tulip poplar) — bees should be bringing in nectar. Only feed if weather blocks forage for extended period.' };
  }
  if (m >= 6 && m <= 7) {
    return { type: 'syrup-1:1', ratio: '1:1', reason: 'Summer dearth — 1:1 syrup if stores are low and no natural forage. Watch for robbing — use robbing screens.' };
  }
  if (m === 8 || m === 9) {
    return { type: 'syrup-2:1', ratio: '2:1', reason: 'Fall — 2:1 syrup for winter stores. Bees need to cap syrup as honey for winter. Critical feeding window.' };
  }
  // October
  return { type: 'fondant', ratio: 'solid', reason: 'Late fall — switch to fondant or dry sugar (Mountain Camp). Too cold for syrup soon.' };
}

/** Estimate syrup consumption rate based on colony size + box count + frame size + season.
 * Factors in:
 * - Population size from last inspection
 * - Number of boxes (more boxes = larger colony = more consumption)
 * - Frame size (deep vs medium vs shallow) — deeps hold more bees
 * - Season (spring buildup drinks more, winter drinks nothing)
 * Returns estimated mL per day. */
export function estimateConsumptionRate(
  populationSize: string,
  month: number,
  boxCount?: number,
  frameType?: string,
): number {
  // Population multiplier from inspection
  const popMultiplier: Record<string, number> = {
    'none': 0,
    'small': 0.3,
    'average': 1.0,
    'large': 1.8,
  };

  // Colony size factor from box count + frame type
  // A single deep (10-frame) holds ~30,000 bees at full capacity
  // A medium holds ~20,000, a shallow ~15,000
  // Each additional box multiplies capacity ~1.5x (not linear — bees cluster)
  const frameAreaFactor: Record<string, number> = {
    'deep': 1.0,
    'medium': 0.67,
    'shallow': 0.5,
    'nuc': 0.3,   // 5-frame nuc
    'small': 0.3,
  };

  // If we have box info, compute a colony-size factor from it
  let colonySizeFactor = 1.0; // default if no box data
  if (boxCount && boxCount > 0) {
    const frameFactor = frameAreaFactor[frameType ?? 'deep'] ?? 1.0;
    // First box is full capacity, each additional box adds ~0.6x
    // (upper boxes aren't always full of bees — honey storage, etc.)
    colonySizeFactor = frameFactor * (1 + (boxCount - 1) * 0.6);
    // Cap at 3x — a 4-box hive doesn't drink 4x as much as a 1-box
    colonySizeFactor = Math.min(colonySizeFactor, 3.0);
  }

  // Seasonal factor — bees drink more syrup in spring buildup, less in fall
  let seasonalFactor = 1.0;
  if (month >= 2 && month <= 4) seasonalFactor = 1.5; // Spring buildup — max consumption
  else if (month >= 5 && month <= 6) seasonalFactor = 0.4; // Nectar flow — little interest in syrup
  else if (month >= 7 && month <= 8) seasonalFactor = 1.0; // Summer dearth
  else if (month >= 9 && month <= 10) seasonalFactor = 1.3; // Fall feeding — storing for winter
  else seasonalFactor = 0.0; // Winter — no liquid syrup

  // Base rate: ~350 mL/day for an average single-deep colony in active feeding season
  const baseRate = 350;
  return Math.round(baseRate * (popMultiplier[populationSize] ?? 1.0) * colonySizeFactor * seasonalFactor);
}

/** Get weight trend for a single hive. */
export function getWeightTrend(hiveId: string): WeightTrend {
  const hive = db.prepare('SELECT entity_id, name FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId) as HiveRow | undefined;
  const hiveName = hive?.name ?? hiveId;

  const rows = db
    .prepare('SELECT entity_id, hiveId, date, hiveWeight FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date ASC')
    .all(hiveId) as InspectionRow[];

  const entries: WeightEntry[] = rows
    .filter((r) => r.hiveWeight > 0)
    .map((r) => ({ inspectionId: r.entity_id, date: r.date, weight: r.hiveWeight }));

  if (entries.length === 0) {
    return {
      hiveId,
      hiveName,
      entries: [],
      currentWeight: null,
      previousWeight: null,
      trend: 'no-data',
      totalChange: 0,
      ratePerWeek: 0,
      threshold: seasonalThreshold(new Date()),
      belowThreshold: false,
      alert: null,
      commentary: hiveName + ' has no weight data yet — record hive weight at inspections to start tracking.',
    };
  }

  const current = entries[entries.length - 1];
  const previous = entries.length > 1 ? entries[entries.length - 2] : null;
  const first = entries[0];
  const threshold = seasonalThreshold(new Date());

  // Calculate trend
  let trend: WeightTrend['trend'] = 'stable';
  let totalChange = current.weight - first.weight;

  if (entries.length >= 2) {
    // Calculate rate per week based on most recent entries (up to 3)
    const recent = entries.slice(-3);
    const daysSpan = Math.max(1, (new Date(recent[recent.length - 1].date).getTime() - new Date(recent[0].date).getTime()) / (1000 * 60 * 60 * 24));
    const recentChange = recent[recent.length - 1].weight - recent[0].weight;
    const ratePerWeek = (recentChange / daysSpan) * 7;

    if (ratePerWeek < -0.5) trend = 'declining';
    else if (ratePerWeek > 0.5) trend = 'gaining';
    else trend = 'stable';

    return {
      hiveId,
      hiveName,
      entries,
      currentWeight: current.weight,
      previousWeight: previous?.weight ?? null,
      trend,
      totalChange: Math.round(totalChange * 10) / 10,
      ratePerWeek: Math.round(ratePerWeek * 10) / 10,
      threshold,
      belowThreshold: current.weight < threshold,
      alert: current.weight < threshold ? `${hiveName} is at ${current.weight} lbs — below the ${threshold} lb seasonal minimum. Feed immediately.` : null,
      commentary: buildCommentary(hiveName, entries, trend, totalChange, current.weight, threshold),
    };
  }

  return {
    hiveId,
    hiveName,
    entries,
    currentWeight: current.weight,
    previousWeight: null,
    trend,
    totalChange: 0,
    ratePerWeek: 0,
    threshold,
    belowThreshold: current.weight < threshold,
    alert: current.weight < threshold ? `${hiveName} is at ${current.weight} lbs — below the ${threshold} lb seasonal minimum.` : null,
    commentary: `${hiveName} weight: ${current.weight} lbs (recorded ${new Date(current.date).toLocaleDateString()}). Need more data points to establish a trend.`,
  };
}

/** Get weight trends for all hives. */
export function getAllWeightTrends(): WeightTrend[] {
  const hives = db.prepare('SELECT entity_id FROM hives WHERE superseded_by IS NULL').all() as { entity_id: string }[];
  return hives.map((h) => getWeightTrend(h.entity_id));
}

function buildCommentary(
  hiveName: string,
  entries: WeightEntry[],
  trend: WeightTrend['trend'],
  totalChange: number,
  currentWeight: number,
  threshold: number,
): string {
  const last = entries[entries.length - 1];
  const first = entries[0];
  const daysSpan = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  parts.push(`${hiveName}: ${currentWeight} lbs as of ${new Date(last.date).toLocaleDateString()}`);

  if (entries.length >= 2) {
    parts.push(`${trend} (${totalChange > 0 ? '+' : ''}${totalChange.toFixed(1)} lbs over ${Math.round(daysSpan)} days)`);
  }

  if (currentWeight < threshold) {
    parts.push(`⚠️ Below ${threshold} lb seasonal minimum — feed immediately`);
  }

  if (trend === 'declining') {
    parts.push('Weight is declining — check for starvation, absconding, or robbing');
  }

  return parts.join('. ') + '.';
}