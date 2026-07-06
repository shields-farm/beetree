// server/outlier.ts — Apiary outlier detection: flag hives falling behind

import { db } from './db.js';
import { calculateHealth } from './omi.js';

export interface HiveStat {
  hiveId: string;
  hiveName: string;
  healthStatus: string;
  populationSize: string;
  honeyStores: string;
  lastInspectionDays: number;
  concerns: number;
  score: number; // computed 0-100
}

export interface OutlierEntry {
  hiveId: string;
  hiveName: string;
  reason: string;
  severity: 'minor' | 'moderate' | 'significant';
  detail: string;
}

export interface OutlierReport {
  apiaryId: string;
  apiaryName: string;
  hiveStats: HiveStat[];
  outliers: OutlierEntry[];
  apiaryAverage: { health: number; population: number; concerns: number };
}

interface ApiaryRow {
  id: string;
  name: string;
}

interface HiveRow {
  id: string;
  apiaryId: string;
  name: string;
  healthStatus: string;
}

interface InspectionRow {
  id: string;
  hiveId: string;
  date: string;
  queenPresent: number;
  queenCells: number;
  queenLayingPattern: string;
  eggsPresent: number;
  larvaePresent: number;
  cappedBrood: number;
  temperament: string;
  honeyStores: string;
  pollenStores: string;
  populationSize: string;
  hiveWeight: number;
  healthStatus: string;
  healthAutoCalculated: number;
  colonyDead: number;
  notes: string;
  photoUrls: string;
}

interface ConcernRow {
  id: string;
  inspectionId: string;
  type: string;
  count: number | null;
  note: string | null;
}

const HEALTH_SCORE: Record<string, number> = {
  excellent: 100,
  good: 80,
  fair: 60,
  poor: 30,
  critical: 0,
};

const POP_SCORE: Record<string, number> = {
  none: 0,
  small: 25,
  average: 60,
  large: 100,
};

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((acc, n) => acc + (n - m) * (n - m), 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Compute a 0-100 score for a hive from its latest inspection + health status.
 * Score = weighted blend of health, population, honey stores, concerns, and
 * recency of inspection.
 */
function computeScore(
  healthStatus: string,
  populationSize: string,
  honeyStores: string,
  concernsCount: number,
  lastInspectionDays: number,
): number {
  let score = 0;
  // Health (40%)
  score += (HEALTH_SCORE[healthStatus] ?? 50) * 0.4;
  // Population (25%)
  score += (POP_SCORE[populationSize] ?? 0) * 0.25;
  // Honey stores (15%)
  const honeyScore: Record<string, number> = { none: 0, low: 30, medium: 60, high: 100 };
  score += (honeyScore[honeyStores] ?? 0) * 0.15;
  // Concerns penalty (10%) — more concerns = lower score
  score += Math.max(0, 100 - concernsCount * 20) * 0.1;
  // Recency (10%) — inspected recently = higher score
  if (lastInspectionDays <= 7) {
    score += 100 * 0.1;
  } else if (lastInspectionDays <= 14) {
    score += 70 * 0.1;
  } else if (lastInspectionDays <= 30) {
    score += 40 * 0.1;
  } else {
    score += 0;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Build the OutlierReport for a single apiary.
 */
export function getOutlierReport(apiaryId: string): OutlierReport | null {
  const apiary = db.prepare('SELECT id, name FROM apiaries WHERE id = ?').get(apiaryId) as ApiaryRow | undefined;
  if (!apiary) return null;

  const hives = db.prepare('SELECT id, apiaryId, name, healthStatus FROM hives WHERE apiaryId = ?').all(apiaryId) as HiveRow[];

  const stats: HiveStat[] = [];

  for (const hive of hives) {
    // Latest inspection
    const insp = db.prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC LIMIT 1').get(hive.id) as InspectionRow | undefined;

    let populationSize = 'none';
    let honeyStores = 'none';
    let lastInspectionDays = 9999;
    let concernsCount = 0;
    let healthStatus = hive.healthStatus;

    if (insp) {
      populationSize = insp.populationSize;
      honeyStores = insp.honeyStores;
      lastInspectionDays = daysSince(insp.date);
      healthStatus = insp.healthStatus;
      const concerns = db.prepare('SELECT * FROM concerns WHERE inspectionId = ?').all(insp.id) as ConcernRow[];
      concernsCount = concerns.length;
    }

    const score = computeScore(healthStatus, populationSize, honeyStores, concernsCount, lastInspectionDays);

    stats.push({
      hiveId: hive.id,
      hiveName: hive.name,
      healthStatus,
      populationSize,
      honeyStores,
      lastInspectionDays: insp ? lastInspectionDays : -1,
      concerns: concernsCount,
      score,
    });
  }

  // Compute averages
  const healthNums = stats.map((s) => HEALTH_SCORE[s.healthStatus] ?? 50);
  const popNums = stats.map((s) => POP_SCORE[s.populationSize] ?? 0);
  const concernNums = stats.map((s) => s.concerns);

  const apiaryAverage = {
    health: mean(healthNums),
    population: mean(popNums),
    concerns: mean(concernNums),
  };

  // Detect outliers
  const scoreStd = stdDev(stats.map((s) => s.score));
  const scoreMean = mean(stats.map((s) => s.score));
  const concernStd = stdDev(concernNums);
  const concernMean = mean(concernNums);

  const outliers: OutlierEntry[] = [];

  for (const s of stats) {
    const reasons: string[] = [];
    let severity: 'minor' | 'moderate' | 'significant' = 'minor';

    // Score > 1 std below mean
    if (scoreStd > 0 && s.score < scoreMean - scoreStd) {
      reasons.push('Overall score ' + s.score + ' is well below the apiary average of ' + Math.round(scoreMean));
      const deficit = scoreMean - s.score;
      if (deficit > 30) severity = 'significant';
      else if (deficit > 15) severity = severity === 'minor' ? 'moderate' : severity;
    }

    // Concerns significantly higher than average
    if (concernStd > 0 && s.concerns > concernMean + concernStd) {
      reasons.push('Has ' + s.concerns + ' concerns vs apiary average of ' + concernMean.toFixed(1));
      if (s.concerns > concernMean + 2 * concernStd) severity = 'significant';
      else if (severity === 'minor') severity = 'moderate';
    }

    // Health critical/poor
    if (s.healthStatus === 'critical' || s.healthStatus === 'poor') {
      reasons.push('Health status is ' + s.healthStatus);
      severity = 'significant';
    }

    // No inspection in a long time
    if (s.lastInspectionDays > 30 && s.lastInspectionDays !== -1) {
      reasons.push('Last inspected ' + s.lastInspectionDays + ' days ago');
      if (severity === 'minor') severity = 'moderate';
    }
    if (s.lastInspectionDays === -1 || s.lastInspectionDays === 9999) {
      reasons.push('No inspection on record');
      if (severity === 'minor') severity = 'moderate';
    }

    if (reasons.length > 0) {
      outliers.push({
        hiveId: s.hiveId,
        hiveName: s.hiveName,
        reason: reasons[0],
        severity,
        detail: reasons.join('; '),
      });
    }
  }

  // Sort outliers by severity (significant first)
  const sevRank: Record<string, number> = { significant: 0, moderate: 1, minor: 2 };
  outliers.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  return {
    apiaryId: apiary.id,
    apiaryName: apiary.name,
    hiveStats: stats.sort((a, b) => b.score - a.score),
    outliers,
    apiaryAverage,
  };
}

/**
 * Get OutlierReports for all apiaries.
 */
export function getAllOutlierReports(): OutlierReport[] {
  const apiaries = db.prepare('SELECT id, name FROM apiaries ORDER BY name').all() as ApiaryRow[];
  const reports: OutlierReport[] = [];
  for (const a of apiaries) {
    const report = getOutlierReport(a.id);
    if (report) reports.push(report);
  }
  return reports;
}