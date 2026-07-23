// server/trending.ts — Hive health trending with local commentary

import { db, type HiveRow, type InspectionRow } from './db.js';

export interface HealthTrend {
  hiveId: string;
  hiveName: string;
  history: { date: string; healthStatus: string; inspectionId: string }[];
  trend: 'improving' | 'stable' | 'declining' | 'insufficient-data';
  commentary: string;
}

const HEALTH_RANK: Record<string, number> = {
  critical: 0,
  poor: 1,
  fair: 2,
  good: 3,
  excellent: 4,
};

function rankOf(status: string): number {
  return HEALTH_RANK[status.toLowerCase()] ?? 2;
}

function determineTrend(statuses: string[]): HealthTrend['trend'] {
  if (statuses.length < 2) return 'insufficient-data';
  // Use the last up-to-3 inspection statuses (chronological order).
  const recent = statuses.slice(-3);
  const ranks = recent.map(rankOf);
  // Compare each to the previous; tally direction.
  let increasing = 0;
  let decreasing = 0;
  let same = 0;
  for (let i = 1; i < ranks.length; i++) {
    const diff = ranks[i] - ranks[i - 1];
    if (diff > 0) increasing++;
    else if (diff < 0) decreasing++;
    else same++;
  }
  if (decreasing > 0 && decreasing >= increasing) return 'declining';
  if (increasing > 0 && increasing > decreasing) return 'improving';
  return 'stable';
}

function buildCommentary(hiveName: string, statuses: string[], trend: HealthTrend['trend']): string {
  if (statuses.length === 0) {
    return hiveName + ' has no inspection history yet — inspect to start tracking health trends.';
  }
  const last = statuses[statuses.length - 1];
  const count = statuses.length;

  if (trend === 'insufficient-data') {
    return 'Only ' + count + ' inspection' + (count === 1 ? '' : 's') + ' recorded for ' + hiveName + ' — need at least 2 to determine a trend. Current status: ' + last + '.';
  }

  if (trend === 'declining') {
    const recent = statuses.slice(-3);
    const runLen = computeDeclineRun(recent);
    if (last === 'poor' || last === 'critical') {
      return hiveName + "'s health has been declining for " + runLen + ' inspection' + (runLen === 1 ? '' : 's') + ' and is now ' + last + ' — consider checking for varroa, disease, or queen issues.';
    }
    return hiveName + "'s brood pattern has been declining for " + runLen + ' inspection' + (runLen === 1 ? '' : 's') + ' — consider checking for varroa or queen problems.';
  }

  if (trend === 'improving') {
    return hiveName + "'s health is improving — last status " + last + ' across ' + count + ' inspection' + (count === 1 ? '' : 's') + '. Keep up the current management.';
  }

  // stable
  if (last === 'excellent' || last === 'good') {
    return 'Health has been stable and ' + last + ' for ' + count + ' inspection' + (count === 1 ? '' : 's') + ' for ' + hiveName + '.';
  }
  return hiveName + "'s health has been stable at " + last + ' for ' + count + ' inspection' + (count === 1 ? '' : 's') + '.';
}

function computeDeclineRun(recent: string[]): number {
  // Count how many of the trailing statuses are part of a decline (each <= prev).
  let run = 1;
  for (let i = recent.length - 1; i > 0; i--) {
    if (rankOf(recent[i]) <= rankOf(recent[i - 1])) {
      run++;
    } else {
      break;
    }
  }
  return run;
}

export function getHealthTrend(hiveId: string): HealthTrend {
  const hive = db.prepare('SELECT * FROM hives WHERE id = ?').get(hiveId) as HiveRow | undefined;
  if (!hive) {
    throw new Error('hive not found: ' + hiveId);
  }
  const rows = db
    .prepare('SELECT id, date, healthStatus FROM inspections WHERE hiveId = ? ORDER BY date ASC')
    .all(hiveId) as Pick<InspectionRow, 'id' | 'date' | 'healthStatus'>[];

  const history = rows.map((r) => ({
    date: r.date,
    healthStatus: r.healthStatus,
    inspectionId: r.id,
  }));

  const statuses = history.map((h) => h.healthStatus);
  const trend = determineTrend(statuses);
  const commentary = buildCommentary(hive.name, statuses, trend);

  return {
    hiveId: hive.id,
    hiveName: hive.name,
    history,
    trend,
    commentary,
  };
}

export function getAllHealthTrends(): HealthTrend[] {
  const hives = db.prepare('SELECT id FROM hives').all() as { id: string }[];
  const trends: HealthTrend[] = [];
  for (const h of hives) {
    try {
      trends.push(getHealthTrend(h.id));
    } catch (e) {
      console.error('[trending] error for hive ' + h.id + ':', e);
    }
  }
  // Sort: declining first, then insufficient-data, then improving, then stable.
  const order: Record<HealthTrend['trend'], number> = {
    declining: 0,
    'insufficient-data': 1,
    improving: 2,
    stable: 3,
  };
  trends.sort((a, b) => order[a.trend] - order[b.trend]);
  return trends;
}