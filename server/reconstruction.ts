// server/reconstruction.ts — Multi-photo frame reconstruction

import { analyzeFramePhoto, type FrameAnalysis } from './vision.js';

export interface FrameReconstruction {
  hiveId: string;
  photoCount: number;
  coverage: number; // estimated 0-1
  combinedAnalysis: {
    totalBrood: number;
    totalHoney: number;
    totalPollen: number;
    empty: number;
    healthSummary: string;
    perPhoto: { index: number; analysis: FrameAnalysis }[];
  };
  recommendations: string[];
}

/**
 * Reconstruct a colony-level health map from multiple frame photos.
 * Analyzes each image with the vision API and combines results.
 */
export async function reconstructColony(
  images: string[],
  hiveId: string,
): Promise<FrameReconstruction> {
  const hiveName = await (async () => {
    // Inline lookup — avoids importing db directly here for testability.
    try {
      const { db } = await import('./db.js');
      const row = db.prepare('SELECT name FROM hives WHERE id = ?').get(hiveId) as { name: string } | undefined;
      return row?.name;
    } catch {
      return undefined;
    }
  })();

  const perPhoto: { index: number; analysis: FrameAnalysis }[] = [];
  let totalBrood = 0;
  let totalHoney = 0;
  let totalPollen = 0;
  let totalEmpty = 0;
  let queenSpottedCount = 0;
  const allDiseases: string[] = [];
  const allPests: string[] = [];
  const allRecommendations: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const analysis = await analyzeFramePhoto(images[i], hiveName);
    perPhoto.push({ index: i, analysis });

    totalBrood += analysis.broodRatio;
    totalHoney += analysis.honeyRatio;
    totalPollen += analysis.pollenRatio;
    // empty = 1 - (brood + honey + pollen), clamped to >= 0
    const frameEmpty = Math.max(0, 1 - (analysis.broodRatio + analysis.honeyRatio + analysis.pollenRatio));
    totalEmpty += frameEmpty;

    if (analysis.queenSpotted) queenSpottedCount++;
    for (const d of analysis.diseases) allDiseases.push(d.type);
    for (const p of analysis.pests) allPests.push(p.type);
    for (const r of analysis.recommendations) allRecommendations.push(r);
  }

  const n = Math.max(1, images.length);
  // Average ratios across photos
  const avgBrood = totalBrood / n;
  const avgHoney = totalHoney / n;
  const avgPollen = totalPollen / n;
  const avgEmpty = totalEmpty / n;

  // Coverage estimate: how much of the colony we've seen — rough heuristic.
  // More photos = higher coverage, capped at 1.
  const coverage = Math.min(1, images.length / 10);

  // Build health summary
  const parts: string[] = [];
  parts.push('Analyzed ' + images.length + ' frame photo' + (images.length === 1 ? '' : 's') + '.');
  parts.push('Average brood coverage: ' + Math.round(avgBrood * 100) + '%, honey: ' + Math.round(avgHoney * 100) + '%, pollen: ' + Math.round(avgPollen * 100) + '%, empty: ' + Math.round(avgEmpty * 100) + '%.');
  if (queenSpottedCount > 0) {
    parts.push('Queen spotted in ' + queenSpottedCount + ' photo' + (queenSpottedCount === 1 ? '' : 's') + '.');
  } else {
    parts.push('Queen not spotted in any photo.');
  }
  const uniqueDiseases = Array.from(new Set(allDiseases));
  const uniquePests = Array.from(new Set(allPests));
  if (uniqueDiseases.length > 0) {
    parts.push('Disease indicators: ' + uniqueDiseases.join(', ') + '.');
  }
  if (uniquePests.length > 0) {
    parts.push('Pest indicators: ' + uniquePests.join(', ') + '.');
  }
  const healthSummary = parts.join(' ');

  // Deduplicate recommendations (case-insensitive)
  const seenRecs = new Set<string>();
  const recommendations: string[] = [];
  for (const r of allRecommendations) {
    const key = r.toLowerCase();
    if (!seenRecs.has(key)) {
      seenRecs.add(key);
      recommendations.push(r);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Continue regular inspections and monitor brood pattern consistency.');
  }

  return {
    hiveId,
    photoCount: images.length,
    coverage,
    combinedAnalysis: {
      totalBrood: Math.round(avgBrood * 100) / 100,
      totalHoney: Math.round(avgHoney * 100) / 100,
      totalPollen: Math.round(avgPollen * 100) / 100,
      empty: Math.round(avgEmpty * 100) / 100,
      healthSummary,
      perPhoto,
    },
    recommendations,
  };
}