// IMPORTANT: OpenTelemetry MUST be imported & started before other imports
// so auto-instrumentation can patch Express, HTTP, fs, etc.
import { startTelemetry, stopTelemetry, apiRequestDurationHistogram, hiveCountGauge, inspectionCountGauge, sensorTemperatureGauge, sensorHumidityGauge, sensorBatteryGauge } from './telemetry.js';
startTelemetry();

import express from 'express';
import cors from 'cors';
import {
  db,
  initSchema,
  mapApiary,
  mapHive,
  mapInspection,
  mapSensor,
  mapTask,
  mapMedia,
  genId,
  type ApiaryRow,
  type HiveRow,
  type BoxRow,
  type FrameSlotRow,
  type InspectionRow,
} from './db.js';
import { seedDatabase } from './seed.js';

initSchema();

// Auto-seed if empty
{
  const c = db.prepare('SELECT COUNT(*) as c FROM apiaries').get() as { c: number };
  if (c.c === 0) {
    console.log('[boot] DB is empty — seeding...');
    seedDatabase();
  }
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ============================================================================
// OpenTelemetry: request duration histogram middleware
// ============================================================================
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = durationNs / 1_000_000;
    const route = req.route?.path || req.path || 'unknown';
    const attrs = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    apiRequestDurationHistogram.record(durationMs, attrs);
  });
  next();
});

// ============================================================================
// OpenTelemetry: periodic gauge updates (every 30s read from DB)
// ============================================================================
interface SensorRow {
  id: string;
  deviceId: string;
  name: string;
  hiveId: string | null;
  latestReading: string | null;
}
interface HiveNameRow { id: string; name: string; }

function updateGaugesFromDB(): void {
  // ObservableGauge callbacks fire automatically on each metric export (every 10s).
  // This periodic function is a place to trigger any side effects or logging.
  try {
    const hiveCount = (db.prepare('SELECT COUNT(*) as c FROM hives').get() as { c: number }).c;
    const inspCount = (db.prepare('SELECT COUNT(*) as c FROM inspections').get() as { c: number }).c;
    const sensorCount = (db.prepare('SELECT COUNT(*) as c FROM sensors').get() as { c: number }).c;
    console.log(`[telemetry] gauge refresh — hives: ${hiveCount}, inspections: ${inspCount}, sensors: ${sensorCount}`);
  } catch (e) {
    console.error('[telemetry] gauge refresh error:', e);
  }
}

// Register observable callbacks that read from DB when metrics are scraped/exported.
hiveCountGauge.addCallback((result) => {
  try {
    const c = (db.prepare('SELECT COUNT(*) as c FROM hives').get() as { c: number }).c;
    result.observe(c);
  } catch { /* DB not ready */ }
});

inspectionCountGauge.addCallback((result) => {
  try {
    const c = (db.prepare('SELECT COUNT(*) as c FROM inspections').get() as { c: number }).c;
    result.observe(c);
  } catch { /* DB not ready */ }
});

sensorTemperatureGauge.addCallback((result) => {
  try {
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors').all() as SensorRow[];
    const hives = db.prepare('SELECT id, name FROM hives').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.id, h.name]));
    for (const s of sensors) {
      if (!s.latestReading) continue;
      const r = JSON.parse(s.latestReading) as { temperature?: number };
      if (typeof r.temperature === 'number') {
        result.observe(r.temperature, {
          hiveName: hiveNameMap.get(s.hiveId || '') || 'unassigned',
          sensorName: s.name,
          deviceId: s.deviceId,
        });
      }
    }
  } catch (e) {
    console.error('[telemetry] sensor_temperature callback error:', e);
  }
});

sensorHumidityGauge.addCallback((result) => {
  try {
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors').all() as SensorRow[];
    const hives = db.prepare('SELECT id, name FROM hives').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.id, h.name]));
    for (const s of sensors) {
      if (!s.latestReading) continue;
      const r = JSON.parse(s.latestReading) as { humidity?: number };
      if (typeof r.humidity === 'number') {
        result.observe(r.humidity, {
          hiveName: hiveNameMap.get(s.hiveId || '') || 'unassigned',
          sensorName: s.name,
          deviceId: s.deviceId,
        });
      }
    }
  } catch (e) {
    console.error('[telemetry] sensor_humidity callback error:', e);
  }
});

sensorBatteryGauge.addCallback((result) => {
  try {
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors').all() as SensorRow[];
    const hives = db.prepare('SELECT id, name FROM hives').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.id, h.name]));
    for (const s of sensors) {
      if (!s.latestReading) continue;
      const r = JSON.parse(s.latestReading) as { batteryVoltage?: number };
      if (typeof r.batteryVoltage === 'number') {
        result.observe(r.batteryVoltage, {
          hiveName: hiveNameMap.get(s.hiveId || '') || 'unassigned',
          sensorName: s.name,
          deviceId: s.deviceId,
        });
      }
    }
  } catch (e) {
    console.error('[telemetry] sensor_battery callback error:', e);
  }
});

// Periodic refresh (every 30s) — gauges are callback-based, so this just logs.
// The callbacks fire on each metric export (every 10s). This interval ensures
// we log gauge refresh activity and could trigger any side effects.
setInterval(() => {
  updateGaugesFromDB();
}, 30_000);

// ============================================================================
// /api/apiaries
// ============================================================================
app.get('/api/apiaries', (_req, res) => {
  const rows = db.prepare('SELECT * FROM apiaries').all() as ApiaryRow[];
  res.json(rows.map(mapApiary));
});

app.get('/api/apiaries/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(req.params.id) as ApiaryRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapApiary(row));
});

app.post('/api/apiaries', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('apiary');
  db.prepare(`INSERT INTO apiaries (id, name, location_lat, location_lng, address, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, b.name ?? '', b.location?.lat ?? null, b.location?.lng ?? null, b.address ?? null, b.notes ?? null);
  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(id) as ApiaryRow;
  res.status(201).json(mapApiary(row));
});

app.put('/api/apiaries/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM apiaries WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE apiaries SET name = ?, location_lat = ?, location_lng = ?, address = ?, notes = ? WHERE id = ?`)
    .run(b.name ?? '', b.location?.lat ?? null, b.location?.lng ?? null, b.address ?? null, b.notes ?? null, req.params.id);
  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(req.params.id) as ApiaryRow;
  res.json(mapApiary(row));
});

app.delete('/api/apiaries/:id', (req, res) => {
  db.prepare('DELETE FROM apiaries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/hives  (includes boxes + frame_slots)
// ============================================================================
function getHiveBoxes(hiveId: string): BoxRow[] {
  return db.prepare('SELECT * FROM boxes WHERE hiveId = ?').all(hiveId) as BoxRow[];
}
function getAllFrameSlots(): FrameSlotRow[] {
  return db.prepare('SELECT * FROM frame_slots').all() as FrameSlotRow[];
}

app.get('/api/hives', (_req, res) => {
  const rows = db.prepare('SELECT * FROM hives').all() as HiveRow[];
  const boxes = db.prepare('SELECT * FROM boxes').all() as BoxRow[];
  const slots = getAllFrameSlots();
  res.json(rows.map((r) => mapHive(r, boxes, slots)));
});

app.get('/api/hives/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(req.params.id) as HiveRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const boxes = getHiveBoxes(row.id);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE boxId IN (SELECT id FROM boxes WHERE hiveId = ?)').all(row.id) as FrameSlotRow[];
  res.json(mapHive(row, boxes, slots));
});

app.post('/api/hives', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('hive');
  const loc = b.location || {};
  db.prepare(`INSERT INTO hives (id, apiaryId, name, type, healthStatus, notes, createdAt, location_lat, location_lng, location_accuracy, location_pinnedAt, location_label, sensorIds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      b.apiaryId,
      b.name ?? '',
      b.type ?? 'langstroth-10',
      b.healthStatus ?? 'good',
      b.notes ?? null,
      b.createdAt ?? new Date().toISOString(),
      loc.lat ?? null,
      loc.lng ?? null,
      loc.accuracy ?? null,
      loc.pinnedAt ?? null,
      loc.label ?? null,
      JSON.stringify(b.sensorIds || []),
    );

  // Insert boxes + frame_slots
  const insBox = db.prepare(`INSERT INTO boxes (id, hiveId, type, "index", sensorIds) VALUES (?, ?, ?, ?, ?)`);
  const insSlot = db.prepare(`INSERT INTO frame_slots (id, boxId, position, content) VALUES (?, ?, ?, ?)`);
  const boxes = b.boxes || [];
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const boxId = box.id || `${id}-box-${i}`;
    insBox.run(boxId, id, box.type, i, JSON.stringify(box.sensorIds || []));
    const frames = box.frames || [];
    for (const f of frames) {
      insSlot.run(genId('fs'), boxId, f.position, f.content || 'empty');
    }
  }

  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(id) as HiveRow;
  const hBoxes = getHiveBoxes(id);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE boxId IN (SELECT id FROM boxes WHERE hiveId = ?)').all(id) as FrameSlotRow[];
  res.status(201).json(mapHive(row, hBoxes, slots));
});

app.put('/api/hives/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  const loc = b.location || {};
  db.prepare(`UPDATE hives SET apiaryId = ?, name = ?, type = ?, healthStatus = ?, notes = ?, location_lat = ?, location_lng = ?, location_accuracy = ?, location_pinnedAt = ?, location_label = ?, sensorIds = ? WHERE id = ?`)
    .run(
      b.apiaryId,
      b.name ?? '',
      b.type ?? 'langstroth-10',
      b.healthStatus ?? 'good',
      b.notes ?? null,
      loc.lat ?? null,
      loc.lng ?? null,
      loc.accuracy ?? null,
      loc.pinnedAt ?? null,
      loc.label ?? null,
      JSON.stringify(b.sensorIds || []),
      req.params.id,
    );

  // Replace boxes + frame_slots if provided
  if (Array.isArray(b.boxes)) {
    db.prepare('DELETE FROM frame_slots WHERE boxId IN (SELECT id FROM boxes WHERE hiveId = ?)').run(req.params.id);
    db.prepare('DELETE FROM boxes WHERE hiveId = ?').run(req.params.id);
    const insBox = db.prepare(`INSERT INTO boxes (id, hiveId, type, "index", sensorIds) VALUES (?, ?, ?, ?, ?)`);
    const insSlot = db.prepare(`INSERT INTO frame_slots (id, boxId, position, content) VALUES (?, ?, ?, ?)`);
    for (let i = 0; i < b.boxes.length; i++) {
      const box = b.boxes[i];
      const boxId = box.id || `${req.params.id}-box-${i}`;
      insBox.run(boxId, req.params.id, box.type, i, JSON.stringify(box.sensorIds || []));
      const frames = box.frames || [];
      for (const f of frames) {
        insSlot.run(genId('fs'), boxId, f.position, f.content || 'empty');
      }
    }
  }

  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(req.params.id) as HiveRow;
  const hBoxes = getHiveBoxes(req.params.id);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE boxId IN (SELECT id FROM boxes WHERE hiveId = ?)').all(req.params.id) as FrameSlotRow[];
  res.json(mapHive(row, hBoxes, slots));
});

app.delete('/api/hives/:id', (req, res) => {
  db.prepare('DELETE FROM hives WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/inspections  (includes concerns)
// ============================================================================
function getConcernsFor(inspectionId: string) {
  return db.prepare('SELECT * FROM concerns WHERE inspectionId = ?').all(inspectionId) as any[];
}

app.get('/api/inspections', (_req, res) => {
  const rows = db.prepare('SELECT * FROM inspections').all() as InspectionRow[];
  res.json(rows.map((r) => mapInspection(r, getConcernsFor(r.id))));
});

app.get('/api/inspections/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id) as InspectionRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapInspection(row, getConcernsFor(row.id)));
});

app.get('/api/hives/:hiveId/inspections', (req, res) => {
  const rows = db.prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC').all(req.params.hiveId) as InspectionRow[];
  res.json(rows.map((r) => mapInspection(r, getConcernsFor(r.id))));
});

app.post('/api/inspections', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('insp');
  db.prepare(`INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      b.hiveId,
      b.date ?? new Date().toISOString(),
      b.queenPresent ? 1 : 0,
      b.queenCells ? 1 : 0,
      b.queenLayingPattern ?? 'none',
      b.eggsPresent ? 1 : 0,
      b.larvaePresent ? 1 : 0,
      b.cappedBrood ? 1 : 0,
      b.temperament ?? 'normal',
      b.honeyStores ?? 'none',
      b.pollenStores ?? 'none',
      b.populationSize ?? 'none',
      b.hiveWeight ?? 0,
      b.healthStatus ?? 'good',
      b.healthAutoCalculated ? 1 : 0,
      b.colonyDead ? 1 : 0,
      b.notes ?? '',
      JSON.stringify(b.photoUrls || []),
    );

  // Concerns
  if (Array.isArray(b.concerns)) {
    const insConcern = db.prepare(`INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)`);
    for (const c of b.concerns) {
      insConcern.run(c.id || genId('c'), id, c.type, c.count ?? null, c.note ?? null);
    }
  }

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as InspectionRow;
  res.status(201).json(mapInspection(row, getConcernsFor(id)));
});

app.put('/api/inspections/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM inspections WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE inspections SET hiveId = ?, date = ?, queenPresent = ?, queenCells = ?, queenLayingPattern = ?, eggsPresent = ?, larvaePresent = ?, cappedBrood = ?, temperament = ?, honeyStores = ?, pollenStores = ?, populationSize = ?, hiveWeight = ?, healthStatus = ?, healthAutoCalculated = ?, colonyDead = ?, notes = ?, photoUrls = ? WHERE id = ?`)
    .run(
      b.hiveId,
      b.date ?? new Date().toISOString(),
      b.queenPresent ? 1 : 0,
      b.queenCells ? 1 : 0,
      b.queenLayingPattern ?? 'none',
      b.eggsPresent ? 1 : 0,
      b.larvaePresent ? 1 : 0,
      b.cappedBrood ? 1 : 0,
      b.temperament ?? 'normal',
      b.honeyStores ?? 'none',
      b.pollenStores ?? 'none',
      b.populationSize ?? 'none',
      b.hiveWeight ?? 0,
      b.healthStatus ?? 'good',
      b.healthAutoCalculated ? 1 : 0,
      b.colonyDead ? 1 : 0,
      b.notes ?? '',
      JSON.stringify(b.photoUrls || []),
      req.params.id,
    );

  // Replace concerns if provided
  if (Array.isArray(b.concerns)) {
    db.prepare('DELETE FROM concerns WHERE inspectionId = ?').run(req.params.id);
    const insConcern = db.prepare(`INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)`);
    for (const c of b.concerns) {
      insConcern.run(c.id || genId('c'), req.params.id, c.type, c.count ?? null, c.note ?? null);
    }
  }

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id) as InspectionRow;
  res.json(mapInspection(row, getConcernsFor(req.params.id)));
});

app.delete('/api/inspections/:id', (req, res) => {
  db.prepare('DELETE FROM inspections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/sensors
// ============================================================================
app.get('/api/sensors', (_req, res) => {
  const rows = db.prepare('SELECT * FROM sensors').all() as any[];
  res.json(rows.map(mapSensor));
});

app.get('/api/sensors/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapSensor(row));
});

app.post('/api/sensors', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('s');
  db.prepare(`INSERT INTO sensors (id, deviceId, name, model, hiveId, boxId, position, latestReading) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.deviceId ?? '', b.name ?? '', b.model ?? '', b.hiveId ?? null, b.boxId ?? null, b.position ?? null, b.latestReading ? JSON.stringify(b.latestReading) : null);
  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(id) as any;
  res.status(201).json(mapSensor(row));
});

app.put('/api/sensors/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM sensors WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE sensors SET deviceId = ?, name = ?, model = ?, hiveId = ?, boxId = ?, position = ?, latestReading = ? WHERE id = ?`)
    .run(b.deviceId ?? '', b.name ?? '', b.model ?? '', b.hiveId ?? null, b.boxId ?? null, b.position ?? null, b.latestReading ? JSON.stringify(b.latestReading) : null, req.params.id);
  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(req.params.id) as any;
  res.json(mapSensor(row));
});

app.delete('/api/sensors/:id', (req, res) => {
  db.prepare('DELETE FROM sensors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/tasks
// ============================================================================
app.get('/api/tasks', (_req, res) => {
  const rows = db.prepare('SELECT * FROM tasks').all() as any[];
  res.json(rows.map(mapTask));
});

app.get('/api/tasks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapTask(row));
});

app.post('/api/tasks', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('task');
  db.prepare(`INSERT INTO tasks (id, hiveId, apiaryId, title, description, dueDate, completed, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.hiveId ?? null, b.apiaryId ?? null, b.title ?? '', b.description ?? null, b.dueDate ?? null, b.completed ? 1 : 0, b.priority ?? 'medium');
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
  res.status(201).json(mapTask(row));
});

app.put('/api/tasks/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE tasks SET hiveId = ?, apiaryId = ?, title = ?, description = ?, dueDate = ?, completed = ?, priority = ? WHERE id = ?`)
    .run(b.hiveId ?? null, b.apiaryId ?? null, b.title ?? '', b.description ?? null, b.dueDate ?? null, b.completed ? 1 : 0, b.priority ?? 'medium', req.params.id);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  res.json(mapTask(row));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/media
// ============================================================================
app.get('/api/media', (req, res) => {
  let rows: any[];
  if (req.query.inspectionId) {
    rows = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? ORDER BY timestamp DESC').all(req.query.inspectionId) as any[];
  } else if (req.query.hiveId) {
    rows = db.prepare('SELECT * FROM media_items WHERE hiveId = ? ORDER BY timestamp DESC').all(req.query.hiveId) as any[];
  } else {
    rows = db.prepare('SELECT * FROM media_items ORDER BY timestamp DESC').all() as any[];
  }
  res.json(rows.map(mapMedia));
});

app.get('/api/media/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM media_items WHERE id = ?').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapMedia(row));
});

app.post('/api/media', (req, res) => {
  const b = req.body || {};
  const id = b.id || genId('media');
  db.prepare(`INSERT INTO media_items (id, inspectionId, hiveId, type, dataUrl, timestamp, label, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.inspectionId ?? null, b.hiveId ?? null, b.type ?? 'photo', b.dataUrl ?? '', b.timestamp ?? new Date().toISOString(), b.label ?? null, b.duration ?? null);
  const row = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as any;
  res.status(201).json(mapMedia(row));
});

app.put('/api/media/:id', (req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT 1 FROM media_items WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE media_items SET inspectionId = ?, hiveId = ?, type = ?, dataUrl = ?, timestamp = ?, label = ?, duration = ? WHERE id = ?`)
    .run(b.inspectionId ?? null, b.hiveId ?? null, b.type ?? 'photo', b.dataUrl ?? '', b.timestamp ?? new Date().toISOString(), b.label ?? null, b.duration ?? null, req.params.id);
  const row = db.prepare('SELECT * FROM media_items WHERE id = ?').get(req.params.id) as any;
  res.json(mapMedia(row));
});

app.delete('/api/media/:id', (req, res) => {
  db.prepare('DELETE FROM media_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// Health check & 404
// ============================================================================
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ============================================================================
// Start
// ============================================================================
const PORT = Number(process.env.PORT || 3001);
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🐝 BeeTree API listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown for OpenTelemetry SDK
process.on('SIGTERM', () => { void stopTelemetry(); process.exit(0); });
process.on('SIGINT', () => { void stopTelemetry(); process.exit(0); });