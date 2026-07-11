export type HiveType =
  | 'langstroth-10'
  | 'langstroth-8'
  | 'long-hive'
  | 'nuc-5'
  | 'apimaye-7'
  | 'apimaye-10'
  | 'queen-castle';

export type BoxType = 'deep' | 'medium' | 'shallow' | 'nuc' | 'apimaye' | 'apimaye-split' | 'queen-castle-comp';

export type BoxContent = 'brood' | 'honey' | 'empty' | 'mixed' | 'pollen';

export type FrameContent =
  | 'empty'
  | 'honey'
  | 'brood'
  | 'pollen'
  | 'feeder'
  | 'queen-excluder'
  | 'foundation';

export type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export type Temperament = 'very-calm' | 'calm' | 'normal' | 'agitated' | 'aggressive';

export type StoreLevel = 'none' | 'low' | 'medium' | 'high';

export type PopulationSize = 'none' | 'small' | 'average' | 'large';

export type QueenLayingPattern = 'excellent' | 'good' | 'fair' | 'poor' | 'none';

export type TaskPriority = 'low' | 'medium' | 'high';

export interface SensorReading {
  temperature: number; // °F
  humidity: number; // %
  batteryVoltage: number;
  signal: number; // dBm
  timestamp: string;
}

export interface Sensor {
  id: string;
  deviceId: string; // e.g., "47:12:87"
  name: string;
  model: string; // TH, TH-Pro, TH-Pro2
  hiveId?: string;
  boxId?: string;
  position?: string; // "top", "bottom", "center"
  latestReading?: SensorReading;
}

export interface Apiary {
  id: string;
  name: string;
  location?: { lat: number; lng: number };
  address?: string;
  notes?: string;
}

export interface FrameSlot {
  position: number; // 0-indexed
  content: FrameContent;
}

export interface Box {
  id: string;
  type: BoxType;
  frames: FrameSlot[];
  sensorIds: string[];
  content?: BoxContent;
}

export interface Hive {
  id: string;
  apiaryId: string;
  name: string;
  type: HiveType;
  boxes: Box[];
  healthStatus: HealthStatus;
  sensorIds?: string[];
  notes?: string;
  createdAt: string;
  location?: {
    lat: number;
    lng: number;
    accuracy?: number; // meters
    pinnedAt?: string; // ISO timestamp of when location was set
    label?: string; // optional label like "near the oak tree"
  };
}

export interface Concern {
  id: string;
  type: string;
  count?: number;
  note?: string;
}

export interface MediaItem {
  id: string;
  type: 'photo' | 'video' | 'audio';
  dataUrl: string;
  timestamp: string;
  label?: string;
  duration?: number;
}

export interface Inspection {
  id: string;
  hiveId: string;
  date: string;
  queenPresent: boolean;
  queenCells: boolean;
  queenLayingPattern: QueenLayingPattern;
  eggsPresent: boolean;
  larvaePresent: boolean;
  cappedBrood: boolean;
  temperament: Temperament;
  honeyStores: StoreLevel;
  pollenStores: StoreLevel;
  populationSize: PopulationSize;
  hiveWeight: number;
  healthStatus: HealthStatus;
  healthAutoCalculated: boolean;
  concerns: Concern[];
  colonyDead: boolean;
  notes: string;
  photoUrls: string[];
  media: MediaItem[];
}

export interface Task {
  id: string;
  hiveId?: string;
  apiaryId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  completed: boolean;
  priority: TaskPriority;
}

export interface HiveTypeDef {
  type: HiveType;
  label: string;
  description: string;
  defaultBoxes: BoxType[];
  allowedBoxTypes: BoxType[];
  frameCountFor: (boxType: BoxType) => number;
  singleBox: boolean;
  supportsSplit?: boolean;
}

export interface AppState {
  apiaries: Apiary[];
  hives: Hive[];
  inspections: Inspection[];
  sensors: Sensor[];
  tasks: Task[];
}