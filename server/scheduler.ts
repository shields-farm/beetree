// server/scheduler.ts — Smart inspection scheduler
// Recommends when to inspect each hive next, based on DB history + season heuristics.

import { db, type HiveRow, type InspectionRow } from './db.js';
import { calculateSwarmRisk } from './swarm.js';

export interface InspectionRecommendation {
  hiveId: string;
  hiveName: string;
  recommendedDate: string; // ISO date
  daysUntil: number;
  priority: 'urgent' | 'soon' | 'routine' | 'low';
  reason: string;
  factors: { factor: string; detail: string }[];
}

interface ConcernRow {
  id: string;
  inspectionId: string;
  type: string;
  count: number | null;
  note: string | null;
}

const PRIORITY_RANK: Record<InspectionRecommendation['priority'], number> = {
  urgent: 0,
  soon: 1,
  routine: 2,
  low: 3,
};

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Season-based inspection interval (days) for Georgia. */
function seasonalInterval(date: Date): { interval: number; detail: string } {
  const m = date.getMonth(); // 0-indexed
  if (m === 3 || m === 4 || m === 5) {
    // April–June: swarm season, inspect every 7 days
    return { interval: 7, detail: 'Swarm season (April–June) — inspect every 7 days to catch queen cells early.' };
  }
  if (m === 6 || m === 7) {
    // July–August: every 10 days
    return { interval: 10, detail: 'Post-swarm season (July–August) — inspect every 10 days.' };
  }
  // Off-season: every 14 days
  return { interval: 14, detail: 'Off-season — inspect every 14 days.' };
}

/**
 * Build a recommendation for a single hive by reading its latest inspection,
 * swarm risk, health status, and the current season.
 */
export async function getHiveSchedule(hiveId: string): Promise<InspectionRecommendation> {
  const hive = db.prepare('SELECT * FROM hives WHERE id = ?').get(hiveId) as HiveRow | undefined;
  if (!hive) {
    throw new Error('hive not found: ' + hiveId);
  }
  return buildRecommendation(hive);
}

/**
 * Build recommendations for every hive, sorted by priority (urgent first),
 * then by daysUntil (soonest first).
 */
export async function getInspectionSchedule(): Promise<InspectionRecommendation[]> {
  const hives = db.prepare('SELECT * FROM hives').all() as HiveRow[];
  const recs: InspectionRecommendation[] = [];
  for (const h of hives) {
    try {
      recs.push(await buildRecommendation(h));
    } catch (e) {
      console.error('[scheduler] error for hive ' + h.id + ':', e);
    }
  }
  recs.sort((a, b) => {
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    }
    return a.daysUntil - b.daysUntil;
  });
  return recs;
}

async function buildRecommendation(hive: HiveRow): Promise<InspectionRecommendation> {
  const now = startOfDay(new Date());
  const factors: InspectionRecommendation['factors'] = [];
  const reasons: string[] = [];

  // Track the highest-priority signal encountered.
  let priority: InspectionRecommendation['priority'] = 'low';

  const bump = (p: InspectionRecommendation['priority']) => {
    if (PRIORITY_RANK[p] < PRIORITY_RANK[priority]) priority = p;
  };

  // --- Latest inspection ---
  const rows = db
    .prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC LIMIT 1')
    .all(hive.id) as InspectionRow[];

  const season = seasonalInterval(now);
  let interval = season.interval;
  factors.push({ factor: 'Season', detail: season.detail });

  let lastInspectionDate: Date | null = null;
  let daysSince = Infinity;

  if (rows.length === 0) {
    // No prior inspection — recommend now (urgent)
    factors.push({
      factor: 'Inspection history',
      detail: 'No inspections on record — inspect this hive to establish a baseline.',
    });
    reasons.push('No inspection history yet');
    bump('urgent');

    const recommendedDate = now;
    return finalize(hive, recommendedDate, 0, 'urgent', reasons, factors);
  }

  const latest = rows[0];
  lastInspectionDate = startOfDay(new Date(latest.date));
  daysSince = Math.max(0, daysBetween(now, lastInspectionDate));

  factors.push({
    factor: 'Last inspection',
    detail: 'Last inspected ' + daysSince + ' day(s) ago, on ' + lastInspectionDate.toISOString().slice(0, 10) + '.',
  });

  // Days-since rules
  if (daysSince > 14) {
    bump('urgent');
    reasons.push('Over 14 days since last inspection');
  } else if (daysSince > 10) {
    bump('soon');
    reasons.push('Over 10 days since last inspection');
  } else if (daysSince > 7) {
    bump('routine');
    reasons.push('Over 7 days since last inspection');
  } else {
    bump('low');
  }

  // --- Swarm risk ---
  try {
    const swarm = await calculateSwarmRisk(hive.id);
    factors.push({
      factor: 'Swarm risk',
      detail: 'Swarm risk score: ' + swarm.riskScore + ' (' + swarm.riskLevel + ').',
    });
    if (swarm.riskScore > 50) {
      bump('urgent');
      reasons.push('High swarm risk (' + swarm.riskScore + ')');
    } else if (swarm.riskScore > 30) {
      bump('soon');
      reasons.push('Moderate swarm risk (' + swarm.riskScore + ')');
    }
  } catch {
    // Swarm risk is best-effort — don't fail the whole recommendation.
    factors.push({ factor: 'Swarm risk', detail: 'Unable to calculate swarm risk.' });
  }

  // --- Health status ---
  const health = hive.healthStatus as string;
  factors.push({
    factor: 'Health status',
    detail: 'Current hive health: ' + health + '.',
  });
  if (health === 'poor' || health === 'critical') {
    bump('urgent');
    reasons.push('Health is ' + health);
  } else if (health === 'fair') {
    bump('soon');
    reasons.push('Health is fair');
  }

  // --- Queen cells in last inspection ---
  if (latest.queenCells) {
    factors.push({
      factor: 'Queen cells',
      detail: 'Queen cells were present at the last inspection — re-inspect to check for swarm preparation.',
    });
    bump('urgent');
    reasons.push('Queen cells found last inspection');
  } else {
    factors.push({
      factor: 'Queen cells',
      detail: 'No queen cells reported at the last inspection.',
    });
  }

  // --- Concerns in last inspection (varroa, disease) ---
  const concerns = db
    .prepare('SELECT * FROM concerns WHERE inspectionId = ?')
    .all(latest.id) as ConcernRow[];
  const concernTypes = concerns.map((c) => c.type.toLowerCase());
  const hasVarroa = concernTypes.some((t) => t.includes('varroa') || t.includes('mite'));
  const hasDisease = concernTypes.some(
    (t) => t.includes('disease') || t.includes('foulbrood') || t.includes('nosema') || t.includes('chalkbrood'),
  );
  if (hasVarroa || hasDisease) {
    const found: string[] = [];
    if (hasVarroa) found.push('varroa');
    if (hasDisease) found.push('disease');
    factors.push({
      factor: 'Concerns',
      detail: 'Last inspection noted: ' + found.join(', ') + '. Re-inspect to monitor.',
    });
    bump('soon');
    reasons.push('Active concerns (' + found.join(', ') + ')');
  } else if (concerns.length > 0) {
    factors.push({
      factor: 'Concerns',
      detail: 'Last inspection recorded ' + concerns.length + ' concern(s): ' + concernTypes.join(', ') + '.',
    });
  } else {
    factors.push({
      factor: 'Concerns',
      detail: 'No concerns recorded at the last inspection.',
    });
  }

  // --- Adjust interval by priority ---
  // Urgent → inspect ASAP (interval 0 from today); soon → halve interval;
  // routine → use seasonal interval; low → extend slightly.
  let recommendedDate: Date;
  const rank = PRIORITY_RANK[priority as InspectionRecommendation['priority']];
  if (rank === PRIORITY_RANK.urgent) {
    recommendedDate = now;
  } else if (rank === PRIORITY_RANK.soon) {
    // Half the seasonal interval from last inspection, but no later than today+season.interval
    const target = new Date(lastInspectionDate);
    target.setDate(target.getDate() + Math.max(1, Math.round(interval / 2)));
    // Don't recommend a past date — clamp to today.
    recommendedDate = target.getTime() < now.getTime() ? now : target;
  } else if (rank === PRIORITY_RANK.routine) {
    const target = new Date(lastInspectionDate);
    target.setDate(target.getDate() + interval);
    recommendedDate = target.getTime() < now.getTime() ? now : target;
  } else {
    // low — use full seasonal interval from last inspection
    const target = new Date(lastInspectionDate);
    target.setDate(target.getDate() + interval);
    recommendedDate = target.getTime() < now.getTime() ? now : target;
  }

  const daysUntil = Math.max(0, daysBetween(recommendedDate, now));

  if (reasons.length === 0) {
    reasons.push('Regular inspection cadence');
  }

  return finalize(hive, recommendedDate, daysUntil, priority, reasons, factors);
}

function finalize(
  hive: HiveRow,
  recommendedDate: Date,
  daysUntil: number,
  priority: InspectionRecommendation['priority'],
  reasons: string[],
  factors: InspectionRecommendation['factors'],
): InspectionRecommendation {
  return {
    hiveId: hive.id,
    hiveName: hive.name,
    recommendedDate: recommendedDate.toISOString(),
    daysUntil,
    priority,
    reason: reasons.join('; '),
    factors,
  };
}