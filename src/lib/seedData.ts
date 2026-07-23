import type { Apiary, Hive, Inspection, Sensor, SensorReading, Task } from '../types';
import { HIVE_TYPES, makeEmptyFrames } from './hiveTypes';

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

export function makeMockReading(tempF: number, hum: number, ageMin = 5): SensorReading {
  return {
    temperature: tempF,
    humidity: hum,
    batteryVoltage: Number((2.7 + Math.random() * 0.4).toFixed(2)),
    signal: -Number(Math.round(50 + Math.random() * 30)),
    timestamp: iso(-ageMin * 60 * 1000),
  };
}

export const SEED_SENSORS: Sensor[] = [
  {
    id: 's-0baf',
    deviceId: '47:0B:AF',
    name: 'BroodMinder-0B',
    model: 'TH-Pro2',
    hiveId: 'hive-1',
    boxId: 'box-1-0',
    position: 'bottom',
    latestReading: makeMockReading(95.2, 62.5, 3),
  },
  {
    id: 's-1287',
    deviceId: '47:12:87',
    name: 'BroodMinder-12',
    model: 'TH-Pro',
    hiveId: 'hive-2',
    boxId: 'box-2-0',
    position: 'center',
    latestReading: makeMockReading(92.8, 58.1, 8),
  },
  {
    id: 's-12c8',
    deviceId: '47:12:C8',
    name: 'BroodMinder-C8',
    model: 'TH-Pro',
    hiveId: 'hive-1',
    boxId: 'box-1-1',
    position: 'top',
    latestReading: makeMockReading(89.4, 51.3, 12),
  },
];

export const SEED_APIARIES: Apiary[] = [
  {
    id: 'apiary-1',
    name: 'Back Yard',
    address: '123 Pollinator Lane',
    location: { lat: 34.0522, lng: -118.2437 },
    notes: 'Backyard apiary — sheltered from prevailing winds by cedar hedge.',
  },
  {
    id: 'apiary-2',
    name: 'Meadow Field',
    address: 'County Road 4, Plot 22',
    location: { lat: 34.0901, lng: -118.3615 },
    notes: 'Open meadow site near wildflower acres. Full sun.',
  },
  {
    id: 'apiary-3',
    name: 'Orchard Edge',
    address: 'Old Orchard Road',
    location: { lat: 34.1521, lng: -118.2342 },
    notes: 'Near apple and pear orchard. Spring pollination focus.',
  },
];

function makeHive(
  id: string,
  apiaryId: string,
  name: string,
  type: import('../types').HiveType,
  ageDays: number,
): Hive {
  const def = HIVE_TYPES[type];
  const boxes = def.defaultBoxes.map((bt, idx) => ({
    id: `${id}-box-${idx}`,
    type: bt,
    frames: makeEmptyFrames(def.frameCountFor(bt)),
    sensorIds: [] as string[],
  }));
  return {
    id,
    apiaryId,
    name,
    type,
    boxes,
    healthStatus: 'good',
    sensorIds: [],
    notes: '',
    createdAt: iso(-ageDays * 24 * 60 * 60 * 1000),
  };
}

export const SEED_HIVES: Hive[] = [
  (() => {
    const h = makeHive('hive-1', 'apiary-1', 'Hive Alpha', 'langstroth-10', 220);
    h.healthStatus = 'excellent';
    h.notes = 'Strong colony, overwintered well.';
    h.boxes[0].sensorIds = ['s-0baf'];
    h.boxes[1].sensorIds = ['s-12c8'];
    h.sensorIds = ['s-0baf', 's-12c8'];
    return h;
  })(),
  (() => {
    const h = makeHive('hive-2', 'apiary-1', 'Hive Bravo', 'long-hive', 180);
    h.healthStatus = 'good';
    h.notes = 'Long hive with 25 deep frames.';
    h.boxes[0].sensorIds = ['s-1287'];
    h.sensorIds = ['s-1287'];
    return h;
  })(),
  (() => {
    const h = makeHive('hive-3', 'apiary-2', 'Nuc Charlie', 'nuc-5', 45);
    h.healthStatus = 'fair';
    h.notes = 'Recently split nuc — building up.';
    return h;
  })(),
  (() => {
    const h = makeHive('hive-4', 'apiary-2', 'Apimaye Delta', 'apimaye-7', 90);
    h.healthStatus = 'good';
    h.notes = 'Insulated Apimaye. Good ventilation.';
    return h;
  })(),
  (() => {
    const h = makeHive('hive-5', 'apiary-3', 'Langstroth Echo', 'langstroth-8', 300);
    h.healthStatus = 'poor';
    h.notes = 'Recovering from varroa pressure. Monitoring closely.';
    return h;
  })(),
  (() => {
    const h = makeHive('hive-6', 'apiary-3', 'Queen Castle Foxtrot', 'queen-castle', 60);
    h.healthStatus = 'good';
    h.notes = 'Queen castle with mating nucs.';
    return h;
  })(),
];

export const SEED_INSPECTIONS: Inspection[] = [
  {
    id: 'insp-1',
    hiveId: 'hive-1',
    date: iso(-3 * 24 * 60 * 60 * 1000),
    queenPresent: true,
    queenCells: false,
    queenLayingPattern: 'excellent',
    eggsPresent: true,
    larvaePresent: true,
    cappedBrood: true,
    temperament: 'calm',
    honeyStores: 'high',
    pollenStores: 'medium',
    populationSize: 'large',
    hiveWeight: 95,
    healthStatus: 'excellent',
    healthAutoCalculated: true,
    concerns: [],
    colonyDead: false,
    notes: 'Colony booming. Saw marked queen on frame 4. Capped honey in top box.',
    photoUrls: [],
    media: [],
  },
  {
    id: 'insp-2',
    hiveId: 'hive-2',
    date: iso(-7 * 24 * 60 * 60 * 1000),
    queenPresent: true,
    queenCells: false,
    queenLayingPattern: 'good',
    eggsPresent: true,
    larvaePresent: true,
    cappedBrood: true,
    temperament: 'calm',
    honeyStores: 'medium',
    pollenStores: 'medium',
    populationSize: 'average',
    hiveWeight: 72,
    healthStatus: 'good',
    healthAutoCalculated: true,
    concerns: [{ id: 'c1', type: 'Small hive beetles', count: 2 }],
    colonyDead: false,
    notes: 'Long hive looking healthy. Bees covering 14 of 25 frames.',
    photoUrls: [],
    media: [],
  },
  {
    id: 'insp-3',
    hiveId: 'hive-5',
    date: iso(-5 * 24 * 60 * 60 * 1000),
    queenPresent: true,
    queenCells: true,
    queenLayingPattern: 'fair',
    eggsPresent: true,
    larvaePresent: false,
    cappedBrood: true,
    temperament: 'normal',
    honeyStores: 'low',
    pollenStores: 'low',
    populationSize: 'small',
    hiveWeight: 38,
    healthStatus: 'poor',
    healthAutoCalculated: true,
    concerns: [
      { id: 'c2', type: 'Varroa count', count: 8, note: 'Alcohol wash, 8/300 mites' },
    ],
    colonyDead: false,
    notes: 'Queen cells present — possible supersedure. Treating for varroa.',
    photoUrls: [],
    media: [],
  },
];

export const SEED_TASKS: Task[] = [
  {
    id: 'task-1',
    apiaryId: 'apiary-1',
    hiveId: 'hive-1',
    title: 'Add honey super',
    description: 'Population is high — add a medium super.',
    dueDate: iso(2 * 24 * 60 * 60 * 1000),
    completed: false,
    priority: 'high',
  },
  {
    id: 'task-2',
    apiaryId: 'apiary-3',
    hiveId: 'hive-5',
    title: 'Varroa treatment follow-up',
    description: 'Check mite drop after treatment.',
    dueDate: iso(1 * 24 * 60 * 60 * 1000),
    completed: false,
    priority: 'high',
  },
  {
    id: 'task-3',
    apiaryId: 'apiary-2',
    title: 'Refill water source',
    description: 'Meadow field water dish is low.',
    dueDate: iso(-1 * 24 * 60 * 60 * 1000),
    completed: false,
    priority: 'medium',
  },
  {
    id: 'task-4',
    apiaryId: 'apiary-1',
    hiveId: 'hive-2',
    title: 'Spring inspection',
    description: 'Full brood check on long hive.',
    dueDate: iso(-3 * 24 * 60 * 60 * 1000),
    completed: true,
    priority: 'medium',
  },
];

export function generateMockSeries(deviceId: string, hours = 48) {
  const points: { time: string; temperature: number; humidity: number }[] = [];
  const baseTemp = 92 + (deviceId.charCodeAt(0) % 5);
  for (let h = hours; h >= 0; h--) {
    const t = new Date(now - h * 60 * 60 * 1000);
    const dayCycle = Math.sin((t.getHours() / 24) * Math.PI * 2 - Math.PI / 2);
    const temp = Number((baseTemp + dayCycle * 4 + Math.sin(h / 3) * 1.2).toFixed(1));
    const hum = Number((58 - dayCycle * 6 + Math.cos(h / 4) * 2).toFixed(1));
    points.push({ time: t.toISOString(), temperature: temp, humidity: hum });
  }
  return points;
}