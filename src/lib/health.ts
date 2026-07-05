import type { HealthStatus, Inspection, StoreLevel, PopulationSize, Temperament } from '../types';

const HEALTH_RANK: Record<HealthStatus, number> = {
  critical: 0,
  poor: 1,
  fair: 2,
  good: 3,
  excellent: 4,
};

const STORE_LEVEL_VALUE: Record<StoreLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const POP_VALUE: Record<PopulationSize, number> = {
  none: 0,
  small: 1,
  average: 2,
  large: 3,
};

const TEMPERAMENT_PENALTY: Record<Temperament, number> = {
  'very-calm': 0,
  calm: 0,
  normal: 0,
  agitated: 1,
  aggressive: 2,
};

export function calculateHealth(i: Pick<
  Inspection,
  | 'queenPresent'
  | 'queenCells'
  | 'queenLayingPattern'
  | 'eggsPresent'
  | 'larvaePresent'
  | 'cappedBrood'
  | 'temperament'
  | 'honeyStores'
  | 'pollenStores'
  | 'populationSize'
  | 'concerns'
  | 'colonyDead'
>): HealthStatus {
  if (i.colonyDead) return 'critical';

  let score = 3; // start at "good"

  const goodLaying = i.queenLayingPattern === 'excellent' || i.queenLayingPattern === 'good';

  // Positive signals: upgrade toward excellent
  if (i.queenPresent) score += 0.5;
  if (goodLaying) score += 0.5;
  if (i.eggsPresent) score += 0.5;
  if (i.larvaePresent) score += 0.5;
  if (i.cappedBrood) score += 0.5;
  if (STORE_LEVEL_VALUE[i.honeyStores] >= 2) score += 0.5;
  if (STORE_LEVEL_VALUE[i.pollenStores] >= 2) score += 0.5;
  if (POP_VALUE[i.populationSize] >= 2) score += 0.5;

  // Negative signals: downgrade
  if (!i.queenPresent) score -= 1;
  if (i.queenLayingPattern === 'poor' || i.queenLayingPattern === 'none') score -= 0.5;
  if (!i.eggsPresent) score -= 0.5;
  if (!i.larvaePresent) score -= 0.5;
  if (!i.cappedBrood) score -= 0.5;
  if (STORE_LEVEL_VALUE[i.honeyStores] === 0) score -= 0.5;
  if (STORE_LEVEL_VALUE[i.pollenStores] === 0) score -= 0.5;
  if (POP_VALUE[i.populationSize] === 0) score -= 0.5;
  if (i.queenCells) score -= 0.5; // could indicate swarming intent
  score -= TEMPERAMENT_PENALTY[i.temperament];

  // Concerns
  if (i.concerns.length > 0) score -= Math.min(i.concerns.length * 0.25, 1.5);

  // Clamp
  score = Math.max(0, Math.min(4, score));
  const rounded = Math.round(score);

  return (Object.keys(HEALTH_RANK).find((k) => HEALTH_RANK[k as HealthStatus] === rounded) ?? 'good') as HealthStatus;
}

export const HEALTH_META: Record<HealthStatus, { label: string; bg: string; text: string; dot: string }> = {
  excellent: { label: 'Excellent', bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  good: { label: 'Good', bg: 'bg-lime-100', text: 'text-lime-800', dot: 'bg-lime-500' },
  fair: { label: 'Fair', bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  poor: { label: 'Poor', bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  critical: { label: 'Critical', bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
};