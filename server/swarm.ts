// server/swarm.ts — Swarm risk assessment from inspection history + season

import { db, type InspectionRow } from './db.js';

export interface SwarmRiskAssessment {
  hiveId: string;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'moderate' | 'high' | 'very-high';
  factors: { factor: string; weight: number; detail: string }[];
  recommendations: string[];
  daysUntilLikelySwarm: number | null; // null if can't predict
}

interface ConcernRow {
  id: string;
  inspectionId: string;
  type: string;
  count: number | null;
  note: string | null;
}

const POP_VAL: Record<string, number> = { none: 0, small: 1, average: 2, large: 3 };
const STORE_VAL: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** Georgia swarm season: mid-March through end of June (peak April-May). */
function seasonalRiskFactor(date: Date): { weight: number; detail: string } {
  const m = date.getMonth(); // 0-indexed (March=2, April=3, ... June=5)
  if (m === 3 || m === 4) {
    return { weight: 25, detail: 'Peak Georgia swarm season (April-May) — colonies are most likely to swarm now.' };
  }
  if (m === 2) {
    return { weight: 15, detail: 'Early swarm season (March) — swarm preparations can begin this month in Georgia.' };
  }
  if (m === 5) {
    return { weight: 12, detail: 'Late swarm season (June) — swarming still occurs but tapers off as nectar flow peaks.' };
  }
  if (m === 6 || m === 7) {
    return { weight: 4, detail: 'Post-swarm season (July-August) — low swarm pressure; colonies focused on foraging.' };
  }
  if (m === 8) {
    return { weight: 2, detail: 'September — very low swarm risk; colonies shifting to winter prep.' };
  }
  return { weight: 0, detail: 'Off-season (Oct-Feb) — minimal swarm risk in Georgia.' };
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function riskLevelFromScore(score: number): SwarmRiskAssessment['riskLevel'] {
  if (score < 25) return 'low';
  if (score < 50) return 'moderate';
  if (score < 75) return 'high';
  return 'very-high';
}

/**
 * Calculate a swarm risk assessment for a single hive by reading its last
 * 3 inspections from the DB and applying weighted seasonal + colony factors.
 */
export async function calculateSwarmRisk(hiveId: string): Promise<SwarmRiskAssessment> {
  const rows = db
    .prepare('SELECT * FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC LIMIT 3')
    .all(hiveId) as InspectionRow[];

  const factors: SwarmRiskAssessment['factors'] = [];
  const recommendations: string[] = [];
  let score = 0;

  const now = new Date();

  // --- Season factor (always applies) ---
  const season = seasonalRiskFactor(now);
  score += season.weight;
  factors.push({ factor: 'Season', weight: season.weight, detail: season.detail });

  if (rows.length === 0) {
    // No inspection history — can't assess colony factors.
    factors.push({
      factor: 'Inspection history',
      weight: 0,
      detail: 'No inspections on record — unable to assess colony-specific swarm factors. Inspect this hive soon.',
    });
    recommendations.push('Inspect this hive to establish a baseline for swarm risk assessment.');
    recommendations.push('During swarm season (April-June), inspect every 7-9 days for queen cells.');
    score = Math.min(score, 35);
    return finalize(hiveId, score, factors, recommendations, null);
  }

  const latest = rows[0];
  const latestDate = new Date(latest.date);
  const daysSinceInspection = Math.max(0, daysBetween(now, latestDate));

  // --- Queen cells (highest-weight colony factor) ---
  if (latest.queenCells) {
    let cellWeight = 30;
    let detail = 'Queen cells present in the most recent inspection.';
    // Check if sealed cells were noted in concerns
    const concerns = db
      .prepare('SELECT * FROM concerns WHERE inspectionId = ? AND superseded_by IS NULL')
      .all(latest.id) as ConcernRow[];
    const cellConcerns = concerns.filter(
      (c) => c.type.toLowerCase().includes('queen cell') || c.type.toLowerCase().includes('queen-cell'),
    );
    if (cellConcerns.length > 0) {
      const total = cellConcerns.reduce((sum, c) => sum + (c.count ?? 1), 0);
      detail = 'Queen cells present in the most recent inspection (' + total + ' cell(s) noted in concerns).';
      if (total >= 3) {
        cellWeight = 35;
        detail += ' Multiple queen cells strongly suggest swarm preparation.';
      }
    }
    // Differentiate capped vs charged cells from notes
    const notesLower = (latest.notes || '').toLowerCase();
    if (notesLower.includes('capped') || notesLower.includes('sealed')) {
      cellWeight = 40;
      detail += ' Capped queen cells noted — swarm is imminent (1-5 days).';
    } else if (notesLower.includes('charged') || notesLower.includes('cup') || notesLower.includes('play')) {
      cellWeight = 20;
      detail += ' Only charged/play cups noted — early swarm preparation, still preventable.';
    }
    score += cellWeight;
    factors.push({ factor: 'Queen cells', weight: cellWeight, detail });
    recommendations.push('Inspect within 2-3 days; if capped queen cells are found, split the hive or perform a Demaree swarm control technique immediately.');
  } else {
    factors.push({
      factor: 'Queen cells',
      weight: 0,
      detail: 'No queen cells reported in the most recent inspection — good sign.',
    });
  }

  // --- Population size & trend ---
  const popNow = POP_VAL[latest.populationSize] ?? 0;
  if (rows.length >= 2) {
    const prev = rows[1];
    const popPrev = POP_VAL[prev.populationSize] ?? 0;
    const trend = popNow - popPrev;
    let popWeight = 0;
    let detail = 'Population: ' + latest.populationSize + '.';
    if (popNow >= 3) {
      popWeight += 12;
      detail += ' Large population.';
      if (trend > 0) {
        popWeight += 6;
        detail += ' Population is growing compared to the previous inspection.';
      }
    } else if (popNow === 2) {
      popWeight += 5;
      detail += ' Average population.';
      if (trend > 0) {
        popWeight += 3;
        detail += ' Growing.';
      }
    } else {
      detail += ' Small/empty population — low swarm risk from crowding.';
    }
    score += popWeight;
    factors.push({ factor: 'Population size & trend', weight: popWeight, detail });
    if (popNow >= 3 && trend > 0) {
      recommendations.push('Consider adding a honey super or making a split to relieve congestion in this large, growing colony.');
    }
  } else {
    let popWeight = 0;
    let detail = 'Population: ' + latest.populationSize + ' (only one inspection on record — no trend).';
    if (popNow >= 3) {
      popWeight = 10;
      detail += ' Large population is a swarm risk factor.';
    }
    score += popWeight;
    factors.push({ factor: 'Population size', weight: popWeight, detail });
  }

  // --- Time since last inspection ---
  let inspectWeight = 0;
  let inspectDetail = 'Last inspected ' + daysSinceInspection + ' day(s) ago.';
  if (daysSinceInspection > 21) {
    inspectWeight = 12;
    inspectDetail += ' Over 3 weeks since last inspection — colony state is unknown and swarm preparations could be underway.';
  } else if (daysSinceInspection > 14) {
    inspectWeight = 7;
    inspectDetail += ' Over 2 weeks since last inspection — check for queen cells soon.';
  } else if (daysSinceInspection > 9) {
    inspectWeight = 3;
    inspectDetail += ' 9+ days since last inspection.';
  }
  score += inspectWeight;
  factors.push({ factor: 'Time since last inspection', weight: inspectWeight, detail: inspectDetail });
  if (daysSinceInspection > 9 && season.weight > 0) {
    recommendations.push('Inspect every 7-9 days during swarm season — queen cells can be built and sealed in under 12 days.');
  }

  // --- Honey stores (high stores + large population = risk) ---
  const honeyNow = STORE_VAL[latest.honeyStores] ?? 0;
  if (honeyNow >= 3 && popNow >= 2) {
    const honeyWeight = 8;
    score += honeyWeight;
    factors.push({
      factor: 'Honey stores',
      weight: honeyWeight,
      detail: 'High honey stores combined with a ' + latest.populationSize + ' population — backfilling brood nest can trigger swarming.',
    });
    recommendations.push('Add supers promptly to give the colony room; consider a reversal of brood boxes if the cluster has moved up.');
  } else if (honeyNow >= 2) {
    factors.push({
      factor: 'Honey stores',
      weight: 2,
      detail: 'Moderate honey stores (' + latest.honeyStores + ').',
    });
  } else {
    factors.push({
      factor: 'Honey stores',
      weight: 0,
      detail: 'Honey stores are ' + latest.honeyStores + ' — not a swarm trigger.',
    });
  }

  // --- Queen seen recently ---
  if (latest.queenPresent) {
    factors.push({
      factor: 'Queen status',
      weight: 0,
      detail: 'Queen was seen in the most recent inspection — marked queen lowers (but does not eliminate) swarm risk.',
    });
  } else {
    // Queen not seen — could be swarm-related (old queen left with swarm) or just missed
    const queenWeight = 5;
    score += queenWeight;
    factors.push({
      factor: 'Queen status',
      weight: queenWeight,
      detail: 'Queen was NOT seen in the most recent inspection. This could indicate she has already departed with a swarm, or she was simply missed.',
    });
    if (latest.eggsPresent) {
      factors[factors.length - 1].detail += ' Eggs were present, so a queen is still active — re-inspect to confirm.';
    } else {
      recommendations.push('Queen was not seen and no eggs reported — verify colony is queenright. If queen cells are capped, a swarm may have already issued.');
    }
  }

  // --- Recently split? (check inspection notes across last 3) ---
  const allNotes = rows.map((r) => (r.notes || '').toLowerCase()).join(' ');
  const splitKeywords = ['split', 'divide', 'nuc', 'walk-away', 'demaree'];
  const recentlySplit = splitKeywords.some((kw) => allNotes.includes(kw));
  if (recentlySplit) {
    // A recent split dramatically reduces swarm risk for ~4 weeks
    score -= 20;
    factors.push({
      factor: 'Recently split',
      weight: -20,
      detail: 'Notes indicate this colony was recently split or divided — swarm risk is reduced for ~4 weeks afterward.',
    });
  } else {
    factors.push({
      factor: 'Recently split',
      weight: 0,
      detail: 'No recent split noted in inspection history.',
    });
  }

  // --- Days until likely swarm ---
  let daysUntilLikelySwarm: number | null = null;
  if (latest.queenCells) {
    const notesLower = (latest.notes || '').toLowerCase();
    if (notesLower.includes('capped') || notesLower.includes('sealed')) {
      // Capped queen cells → swarm within 1-5 days
      daysUntilLikelySwarm = Math.max(1, 5 - daysSinceInspection);
      if (daysUntilLikelySwarm < 1) daysUntilLikelySwarm = 1;
    } else if (notesLower.includes('charged')) {
      // Charged cells → 8-14 days until swarm (needs to be capped, then swarm)
      daysUntilLikelySwarm = Math.max(1, 12 - daysSinceInspection);
    } else {
      // Unspecified queen cells → assume ~10 days
      daysUntilLikelySwarm = Math.max(1, 10 - daysSinceInspection);
    }
  } else if (score >= 60 && season.weight >= 12) {
    // High risk + in season without confirmed cells — moderate estimate
    daysUntilLikelySwarm = 14;
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Default recommendations if none generated
  if (recommendations.length === 0) {
    if (score < 25) {
      recommendations.push('Swarm risk is low. Maintain your regular inspection cadence (every 10-14 days).');
    } else if (score < 50) {
      recommendations.push('Swarm risk is moderate. Inspect within 7-9 days and watch for queen cell construction.');
    } else if (score < 75) {
      recommendations.push('Swarm risk is high. Inspect within 3-5 days for queen cells. Be ready to split or add supers.');
    } else {
      recommendations.push('Swarm risk is very high. Inspect immediately for capped queen cells. Split or perform Demaree swarm control right away.');
    }
  }

  return finalize(hiveId, score, factors, recommendations, daysUntilLikelySwarm);
}

function finalize(
  hiveId: string,
  score: number,
  factors: SwarmRiskAssessment['factors'],
  recommendations: string[],
  daysUntilLikelySwarm: number | null,
): SwarmRiskAssessment {
  return {
    hiveId,
    riskScore: score,
    riskLevel: riskLevelFromScore(score),
    factors,
    recommendations,
    daysUntilLikelySwarm,
  };
}

/**
 * Calculate swarm risk for every hive in the database.
 * Returns an array of assessments sorted by risk score (highest first).
 */
export async function calculateSwarmRiskAll(): Promise<SwarmRiskAssessment[]> {
  const hives = db.prepare('SELECT entity_id AS id FROM hives WHERE superseded_by IS NULL').all() as { id: string }[];
  const assessments: SwarmRiskAssessment[] = [];
  for (const h of hives) {
    try {
      const a = await calculateSwarmRisk(h.id);
      assessments.push(a);
    } catch (e) {
      console.error('[swarm] error for hive ' + h.id + ':', e);
    }
  }
  assessments.sort((a, b) => b.riskScore - a.riskScore);
  return assessments;
}