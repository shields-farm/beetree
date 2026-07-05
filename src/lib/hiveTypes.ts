import type {
  BoxType,
  FrameContent,
  FrameSlot,
  HealthStatus,
  HiveType,
  PopulationSize,
  QueenLayingPattern,
  StoreLevel,
  Temperament,
} from '../types';

export const HIVE_TYPES: Record<HiveType, {
  type: HiveType;
  label: string;
  description: string;
  defaultBoxes: BoxType[];
  allowedBoxTypes: BoxType[];
  frameCountFor: (boxType: BoxType) => number;
  singleBox: boolean;
  supportsSplit?: boolean;
}> = {
  'langstroth-10': {
    type: 'langstroth-10',
    label: 'Langstroth 10-frame',
    description: 'Standard 10-frame Langstroth with deep, medium, and shallow boxes.',
    defaultBoxes: ['deep', 'deep'],
    allowedBoxTypes: ['deep', 'medium', 'shallow'],
    frameCountFor: () => 10,
    singleBox: false,
  },
  'langstroth-8': {
    type: 'langstroth-8',
    label: 'Langstroth 8-frame',
    description: '8-frame Langstroth (garden hive) with deep, medium, and shallow boxes.',
    defaultBoxes: ['deep', 'medium'],
    allowedBoxTypes: ['deep', 'medium', 'shallow'],
    frameCountFor: () => 8,
    singleBox: false,
  },
  'long-hive': {
    type: 'long-hive',
    label: 'Horizontal Long Hive',
    description: 'Single horizontal box holding 25 deep frames.',
    defaultBoxes: ['deep'],
    allowedBoxTypes: ['deep'],
    frameCountFor: () => 25,
    singleBox: true,
  },
  'nuc-5': {
    type: 'nuc-5',
    label: '5-frame Nuc',
    description: '5-frame nucleus colony box.',
    defaultBoxes: ['nuc'],
    allowedBoxTypes: ['nuc'],
    frameCountFor: () => 5,
    singleBox: true,
  },
  'apimaye-7': {
    type: 'apimaye-7',
    label: '7-frame Apimaye',
    description: '7-frame Apimaye hive; can be split to 2×3 for queen mating nuc.',
    defaultBoxes: ['apimaye'],
    allowedBoxTypes: ['apimaye', 'apimaye-split'],
    frameCountFor: (bt) => (bt === 'apimaye-split' ? 3 : 7),
    singleBox: true,
    supportsSplit: true,
  },
  'queen-castle': {
    type: 'queen-castle',
    label: 'Apimaye Queen Castle',
    description: 'Apimaye Queen Castle with configurable compartments (3-4).',
    defaultBoxes: ['queen-castle-comp'],
    allowedBoxTypes: ['queen-castle-comp'],
    frameCountFor: () => 12,
    singleBox: true,
  },
};

export const BOX_TYPE_LABELS: Record<BoxType, string> = {
  deep: 'Deep',
  medium: 'Medium',
  shallow: 'Shallow',
  nuc: 'Nuc',
  apimaye: 'Apimaye',
  'apimaye-split': 'Apimaye (Split 2×3)',
  'queen-castle-comp': 'Queen Castle',
};

export const FRAME_CONTENT_ORDER: FrameContent[] = [
  'empty',
  'honey',
  'brood',
  'pollen',
  'feeder',
  'queen-excluder',
  'foundation',
];

export const FRAME_CONTENT_META: Record<FrameContent, { label: string; color: string; textColor: string; icon: string }> = {
  empty: { label: 'Empty', color: '#f5f5f4', textColor: '#78716c', icon: '○' },
  honey: { label: 'Honey', color: '#fbbf24', textColor: '#78350f', icon: '🍯' },
  brood: { label: 'Brood', color: '#a16207', textColor: '#fef3c7', icon: '🐝' },
  pollen: { label: 'Pollen', color: '#facc15', textColor: '#713f12', icon: '🌼' },
  feeder: { label: 'Feeder', color: '#0ea5e9', textColor: '#0c4a6e', icon: '💧' },
  'queen-excluder': { label: 'Queen Excluder', color: '#52525b', textColor: '#fafafa', icon: '☰' },
  foundation: { label: 'Foundation', color: '#e7e5e4', textColor: '#44403c', icon: '▭' },
};

export function makeEmptyFrames(count: number): FrameSlot[] {
  return Array.from({ length: count }, (_, i) => ({ position: i, content: 'empty' as FrameContent }));
}

export function nextFrameContent(current: FrameContent): FrameContent {
  const idx = FRAME_CONTENT_ORDER.indexOf(current);
  return FRAME_CONTENT_ORDER[(idx + 1) % FRAME_CONTENT_ORDER.length];
}

export const TEMPERAMENT_OPTIONS: { value: Temperament; label: string }[] = [
  { value: 'very-calm', label: 'Very Calm' },
  { value: 'calm', label: 'Calm' },
  { value: 'normal', label: 'Normal' },
  { value: 'agitated', label: 'Agitated' },
  { value: 'aggressive', label: 'Aggressive' },
];

export const LAYING_PATTERN_OPTIONS: { value: QueenLayingPattern; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'none', label: 'None' },
];

export const STORE_LEVEL_OPTIONS: { value: StoreLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const POPULATION_OPTIONS: { value: PopulationSize; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'average', label: 'Average' },
  { value: 'large', label: 'Large' },
];

export const HEALTH_OPTIONS: { value: HealthStatus; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];