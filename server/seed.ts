/**
 * Seed the SQLite database with the same sample data that ships in
 * src/lib/seedData.ts. Safe to run multiple times — it only seeds when
 * the apiaries table is empty.
 */
import { db } from './db.js';
import { genId } from './db.js';

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

// --- Hive-type metadata (mirrors src/lib/hiveTypes.ts) ----------------------
const HIVE_TYPE_DEFS: Record<string, { defaultBoxes: string[]; frameCountFor: (bt: string) => number }> = {
  'langstroth-10': { defaultBoxes: ['deep', 'deep'], frameCountFor: () => 10 },
  'langstroth-8':  { defaultBoxes: ['deep', 'medium'], frameCountFor: () => 8 },
  'long-hive':     { defaultBoxes: ['deep'], frameCountFor: () => 25 },
  'nuc-5':         { defaultBoxes: ['nuc'], frameCountFor: () => 5 },
  'apimaye-7':     { defaultBoxes: ['apimaye'], frameCountFor: (bt) => (bt === 'apimaye-split' ? 3 : 7) },
  'queen-castle':  { defaultBoxes: ['queen-castle-comp'], frameCountFor: () => 12 },
};

function makeEmptyFrames(count: number) {
  return Array.from({ length: count }, (_, i) => ({ position: i, content: 'empty' }));
}

interface SeedHive {
  id: string; apiaryId: string; name: string; type: string; ageDays: number;
  healthStatus: string; notes: string; sensorIds: string[];
  boxSensors: Record<number, string[]>; // boxIndex -> sensorIds
}

const SEED_HIVES: SeedHive[] = [
  { id: 'hive-1', apiaryId: 'apiary-1', name: 'Hive Alpha', type: 'langstroth-10', ageDays: 220, healthStatus: 'excellent', notes: 'Strong colony, overwintered well.', sensorIds: ['s-0baf', 's-12c8'], boxSensors: { 0: ['s-0baf'], 1: ['s-12c8'] } },
  { id: 'hive-2', apiaryId: 'apiary-1', name: 'Hive Bravo', type: 'long-hive', ageDays: 180, healthStatus: 'good', notes: 'Long hive with 25 deep frames.', sensorIds: ['s-1287'], boxSensors: { 0: ['s-1287'] } },
  { id: 'hive-3', apiaryId: 'apiary-2', name: 'Nuc Charlie', type: 'nuc-5', ageDays: 45, healthStatus: 'fair', notes: 'Recently split nuc — building up.', sensorIds: [], boxSensors: {} },
  { id: 'hive-4', apiaryId: 'apiary-2', name: 'Apimaye Delta', type: 'apimaye-7', ageDays: 90, healthStatus: 'good', notes: 'Insulated Apimaye. Good ventilation.', sensorIds: [], boxSensors: {} },
  { id: 'hive-5', apiaryId: 'apiary-3', name: 'Langstroth Echo', type: 'langstroth-8', ageDays: 300, healthStatus: 'poor', notes: 'Recovering from varroa pressure. Monitoring closely.', sensorIds: [], boxSensors: {} },
  { id: 'hive-6', apiaryId: 'apiary-3', name: 'Queen Castle Foxtrot', type: 'queen-castle', ageDays: 60, healthStatus: 'good', notes: 'Queen castle with mating nucs.', sensorIds: [], boxSensors: {} },
];

const SEED_APIARIES = [
  { id: 'apiary-1', name: 'Back Yard', address: '123 Pollinator Lane', location: { lat: 34.0522, lng: -118.2437 }, notes: 'Backyard apiary — sheltered from prevailing winds by cedar hedge.' },
  { id: 'apiary-2', name: 'Meadow Field', address: 'County Road 4, Plot 22', location: { lat: 34.0901, lng: -118.3615 }, notes: 'Open meadow site near wildflower acres. Full sun.' },
  { id: 'apiary-3', name: 'Orchard Edge', address: 'Old Orchard Road', location: { lat: 34.1521, lng: -118.2342 }, notes: 'Near apple and pear orchard. Spring pollination focus.' },
];

const SEED_SENSORS = [
  { id: 's-0baf', deviceId: '47:0B:AF', name: 'BroodMinder-0B', model: 'TH-Pro2', hiveId: 'hive-1', boxId: 'hive-1-box-0', position: 'bottom', latestReading: { temperature: 95.2, humidity: 62.5, batteryVoltage: 2.91, signal: -62, timestamp: iso(-3 * 60 * 1000) } },
  { id: 's-1287', deviceId: '47:12:87', name: 'BroodMinder-12', model: 'TH-Pro', hiveId: 'hive-2', boxId: 'hive-2-box-0', position: 'center', latestReading: { temperature: 92.8, humidity: 58.1, batteryVoltage: 2.83, signal: -71, timestamp: iso(-8 * 60 * 1000) } },
  { id: 's-12c8', deviceId: '47:12:C8', name: 'BroodMinder-C8', model: 'TH-Pro', hiveId: 'hive-1', boxId: 'hive-1-box-1', position: 'top', latestReading: { temperature: 89.4, humidity: 51.3, batteryVoltage: 2.97, signal: -58, timestamp: iso(-12 * 60 * 1000) } },
];

const SEED_INSPECTIONS = [
  {
    id: 'insp-1', hiveId: 'hive-1', date: iso(-3 * 24 * 60 * 60 * 1000),
    queenPresent: true, queenCells: false, queenLayingPattern: 'excellent',
    eggsPresent: true, larvaePresent: true, cappedBrood: true,
    temperament: 'calm', honeyStores: 'high', pollenStores: 'medium',
    populationSize: 'large', hiveWeight: 95, healthStatus: 'excellent',
    healthAutoCalculated: true, colonyDead: false,
    notes: 'Colony booming. Saw marked queen on frame 4. Capped honey in top box.',
    photoUrls: [] as string[], concerns: [] as any[],
  },
  {
    id: 'insp-2', hiveId: 'hive-2', date: iso(-7 * 24 * 60 * 60 * 1000),
    queenPresent: true, queenCells: false, queenLayingPattern: 'good',
    eggsPresent: true, larvaePresent: true, cappedBrood: true,
    temperament: 'calm', honeyStores: 'medium', pollenStores: 'medium',
    populationSize: 'average', hiveWeight: 72, healthStatus: 'good',
    healthAutoCalculated: true, colonyDead: false,
    notes: 'Long hive looking healthy. Bees covering 14 of 25 frames.',
    photoUrls: [] as string[],
    concerns: [{ id: 'c1', type: 'Small hive beetles', count: 2, note: undefined }],
  },
  {
    id: 'insp-3', hiveId: 'hive-5', date: iso(-5 * 24 * 60 * 60 * 1000),
    queenPresent: true, queenCells: true, queenLayingPattern: 'fair',
    eggsPresent: true, larvaePresent: false, cappedBrood: true,
    temperament: 'normal', honeyStores: 'low', pollenStores: 'low',
    populationSize: 'small', hiveWeight: 38, healthStatus: 'poor',
    healthAutoCalculated: true, colonyDead: false,
    notes: 'Queen cells present — possible supersedure. Treating for varroa.',
    photoUrls: [] as string[],
    concerns: [{ id: 'c2', type: 'Varroa count', count: 8, note: 'Alcohol wash, 8/300 mites' }],
  },
];

const SEED_TASKS = [
  { id: 'task-1', apiaryId: 'apiary-1', hiveId: 'hive-1', title: 'Add honey super', description: 'Population is high — add a medium super.', dueDate: iso(2 * 24 * 60 * 60 * 1000), completed: false, priority: 'high' },
  { id: 'task-2', apiaryId: 'apiary-3', hiveId: 'hive-5', title: 'Varroa treatment follow-up', description: 'Check mite drop after treatment.', dueDate: iso(1 * 24 * 60 * 60 * 1000), completed: false, priority: 'high' },
  { id: 'task-3', apiaryId: 'apiary-2', hiveId: undefined as any, title: 'Refill water source', description: 'Meadow field water dish is low.', dueDate: iso(-1 * 24 * 60 * 60 * 1000), completed: false, priority: 'medium' },
  { id: 'task-4', apiaryId: 'apiary-1', hiveId: 'hive-2', title: 'Spring inspection', description: 'Full brood check on long hive.', dueDate: iso(-3 * 24 * 60 * 60 * 1000), completed: true, priority: 'medium' },
];

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------
export function seedDatabase(force = false): void {
  const tx = db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) as c FROM apiaries').get() as { c: number };
    if (!force && count.c > 0) {
      console.log('[seed] DB already has data — skipping seed.');
      return;
    }
    console.log('[seed] Seeding database...');

    // Clear all tables (order respects FK constraints)
    for (const t of ['tasks', 'media_items', 'concerns', 'inspections', 'sensors', 'frame_slots', 'boxes', 'hives', 'apiaries']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }

    // --- Apiaries ---
    const insApiary = db.prepare(`INSERT INTO apiaries (id, name, location_lat, location_lng, address, notes) VALUES (@id, @name, @lat, @lng, @address, @notes)`);
    for (const a of SEED_APIARIES) {
      insApiary.run({ id: a.id, name: a.name, lat: a.location?.lat ?? null, lng: a.location?.lng ?? null, address: a.address ?? null, notes: a.notes ?? null });
    }

    // --- Hives + Boxes + FrameSlots ---
    const insHive = db.prepare(`INSERT INTO hives (id, apiaryId, name, type, healthStatus, notes, createdAt, location_lat, location_lng, location_accuracy, location_pinnedAt, location_label, sensorIds) VALUES (@id, @apiaryId, @name, @type, @healthStatus, @notes, @createdAt, @lat, @lng, @accuracy, @pinnedAt, @label, @sensorIds)`);
    const insBox = db.prepare(`INSERT INTO boxes (id, hiveId, type, "index", sensorIds) VALUES (@id, @hiveId, @type, @index, @sensorIds)`);
    const insSlot = db.prepare(`INSERT INTO frame_slots (id, boxId, position, content) VALUES (@id, @boxId, @position, @content)`);

    for (const h of SEED_HIVES) {
      insHive.run({
        id: h.id, apiaryId: h.apiaryId, name: h.name, type: h.type,
        healthStatus: h.healthStatus, notes: h.notes, createdAt: iso(-h.ageDays * 24 * 60 * 60 * 1000),
        lat: null, lng: null, accuracy: null, pinnedAt: null, label: null,
        sensorIds: JSON.stringify(h.sensorIds),
      });

      const def = HIVE_TYPE_DEFS[h.type];
      def.defaultBoxes.forEach((boxType, idx) => {
        const boxId = `${h.id}-box-${idx}`;
        const frameCount = def.frameCountFor(boxType);
        const boxSensors = h.boxSensors[idx] || [];
        insBox.run({ id: boxId, hiveId: h.id, type: boxType, index: idx, sensorIds: JSON.stringify(boxSensors) });
        const frames = makeEmptyFrames(frameCount);
        for (const f of frames) {
          insSlot.run({ id: genId('fs'), boxId, position: f.position, content: f.content });
        }
      });
    }

    // --- Sensors ---
    const insSensor = db.prepare(`INSERT INTO sensors (id, deviceId, name, model, hiveId, boxId, position, latestReading) VALUES (@id, @deviceId, @name, @model, @hiveId, @boxId, @position, @latestReading)`);
    for (const s of SEED_SENSORS) {
      insSensor.run({
        id: s.id, deviceId: s.deviceId, name: s.name, model: s.model,
        hiveId: s.hiveId ?? null, boxId: s.boxId ?? null, position: s.position ?? null,
        latestReading: s.latestReading ? JSON.stringify(s.latestReading) : null,
      });
    }

    // --- Inspections + Concerns ---
    const insInsp = db.prepare(`INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (@id, @hiveId, @date, @queenPresent, @queenCells, @queenLayingPattern, @eggsPresent, @larvaePresent, @cappedBrood, @temperament, @honeyStores, @pollenStores, @populationSize, @hiveWeight, @healthStatus, @healthAutoCalculated, @colonyDead, @notes, @photoUrls)`);
    const insConcern = db.prepare(`INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (@id, @inspectionId, @type, @count, @note)`);
    for (const i of SEED_INSPECTIONS) {
      insInsp.run({
        id: i.id, hiveId: i.hiveId, date: i.date,
        queenPresent: i.queenPresent ? 1 : 0, queenCells: i.queenCells ? 1 : 0,
        queenLayingPattern: i.queenLayingPattern,
        eggsPresent: i.eggsPresent ? 1 : 0, larvaePresent: i.larvaePresent ? 1 : 0,
        cappedBrood: i.cappedBrood ? 1 : 0, temperament: i.temperament,
        honeyStores: i.honeyStores, pollenStores: i.pollenStores,
        populationSize: i.populationSize, hiveWeight: i.hiveWeight,
        healthStatus: i.healthStatus, healthAutoCalculated: i.healthAutoCalculated ? 1 : 0,
        colonyDead: i.colonyDead ? 1 : 0, notes: i.notes,
        photoUrls: JSON.stringify(i.photoUrls),
      });
      for (const c of i.concerns) {
        insConcern.run({ id: c.id, inspectionId: i.id, type: c.type, count: c.count ?? null, note: c.note ?? null });
      }
    }

    // --- Tasks ---
    const insTask = db.prepare(`INSERT INTO tasks (id, hiveId, apiaryId, title, description, dueDate, completed, priority) VALUES (@id, @hiveId, @apiaryId, @title, @description, @dueDate, @completed, @priority)`);
    for (const t of SEED_TASKS) {
      insTask.run({
        id: t.id, hiveId: t.hiveId ?? null, apiaryId: t.apiaryId ?? null,
        title: t.title, description: t.description ?? null, dueDate: t.dueDate ?? null,
        completed: t.completed ? 1 : 0, priority: t.priority,
      });
    }

    console.log('[seed] Done.');
  });

  tx();
}

// Allow running directly: `tsx seed.ts`
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase(true);
  console.log('[seed] Seed complete.');
}