// IMPORTANT: OpenTelemetry MUST be imported & started before other imports
// so auto-instrumentation can patch Express, HTTP, fs, etc.
import { startTelemetry, stopTelemetry, apiRequestDurationHistogram, hiveCountGauge, inspectionCountGauge, sensorTemperatureGauge, sensorHumidityGauge, sensorBatteryGauge } from './telemetry.js';
startTelemetry();

// Load .env file (simple parser, no dotenv dependency)
import fs from 'fs';
import path from 'path';
try {
  const envPath = path.join(import.meta.dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
} catch { /* ignore */ }

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
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

// ============================================================================
// Security: Bearer token authentication
// ============================================================================
// Set BEETREE_API_KEY in environment or .env file. If not set, one is generated
// and printed to the console on boot (so local dev still works, but production
// behind Tailscale Funnel requires the token).
const API_KEY = process.env.BEETREE_API_KEY || crypto.randomBytes(24).toString('hex');
const AUTH_DISABLED = process.env.BEETREE_DISABLE_AUTH === '1';

// Timing-safe token comparison
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Bearer token middleware — applied to all /api routes except /api/health
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (AUTH_DISABLED) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Send Authorization: Bearer <token> header.' });
  }
  const token = auth.slice(7).trim();
  if (!token || !safeCompare(token, API_KEY)) {
    return res.status(403).json({ error: 'Invalid API key.' });
  }
  next();
}

// ============================================================================
// CORS: restrict to known origins (Tailscale + localhost)
// ============================================================================
const ALLOWED_ORIGINS = [
  'https://beetree-host.tailnet-id.ts.net',
  'https://localhost:5173',
  'https://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, same-origin via proxy)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Simple rate limiting (in-memory, per-IP, 100 requests per minute)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60_000; // 1 minute

app.use((req, _res, next) => {
  // Skip rate limit for health check
  if (req.path === '/api/health') return next();

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      _res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return;
    }
  }
  next();
});

// Apply auth to all /api routes except health
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return authMiddleware(req, res, next);
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

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
  res.json(rows.map((r) => {
    const insp = mapInspection(r, getConcernsFor(r.id));
    const media = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? ORDER BY timestamp DESC').all(r.id) as any[];
    insp.media = media.map(mapMedia);
    return insp;
  }));
});

app.get('/api/inspections/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id) as InspectionRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const insp = mapInspection(row, getConcernsFor(row.id));
  const media = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? ORDER BY timestamp DESC').all(row.id) as any[];
  insp.media = media.map(mapMedia);
  res.json(insp);
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
// /api/omi — Omi voice transcript integration
// ============================================================================
import {
  parseTranscriptToInspection,
  parseFreeTextToInspection,
  calculateHealth,
  listRecentTranscripts,
  readTranscriptByDate,
  type ParsedInspection,
} from './omi.js';

app.post('/api/omi/transcript', async (req, res) => {
  try {
    const { transcript } = req.body || {};
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript (string) is required' });
    }
    const hiveRows = db.prepare('SELECT id, name FROM hives').all() as { id: string; name: string }[];
    const parsed = await parseTranscriptToInspection(transcript, hiveRows);
    res.json({ parsed, raw: transcript });
  } catch (e) {
    console.error('[omi/transcript] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'parse failed' });
  }
});

app.post('/api/omi/confirm', (req, res) => {
  try {
    const { parsed, hiveId } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const p: ParsedInspection = parsed || {};
    const health = calculateHealth({
      queenPresent: p.queenPresent,
      queenCells: p.queenCells,
      queenLayingPattern: p.queenLayingPattern,
      eggsPresent: p.eggsPresent,
      larvaePresent: p.larvaePresent,
      cappedBrood: p.cappedBrood,
      temperament: p.temperament,
      honeyStores: p.honeyStores,
      pollenStores: p.pollenStores,
      populationSize: p.populationSize,
      concerns: p.concerns ?? [],
      colonyDead: false,
    });

    const id = genId('insp');
    db.prepare(
      `INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      hiveId,
      new Date().toISOString(),
      p.queenPresent ? 1 : 0,
      p.queenCells ? 1 : 0,
      p.queenLayingPattern ?? 'none',
      p.eggsPresent ? 1 : 0,
      p.larvaePresent ? 1 : 0,
      p.cappedBrood ? 1 : 0,
      p.temperament ?? 'normal',
      p.honeyStores ?? 'none',
      p.pollenStores ?? 'none',
      p.populationSize ?? 'none',
      0,
      health,
      1, // auto-calculated
      0, // not dead
      p.notes ?? '',
      JSON.stringify([]),
    );

    // Insert concerns
    if (Array.isArray(p.concerns)) {
      const insConcern = db.prepare(
        `INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const c of p.concerns) {
        if (!c.type) continue;
        insConcern.run(genId('c'), id, c.type, c.count ?? null, c.note ?? null);
      }
    }

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as InspectionRow;
    // Update hive health status to match latest inspection
    db.prepare('UPDATE hives SET healthStatus = ? WHERE id = ?').run(health, hiveId);
    res.status(201).json(mapInspection(row, getConcernsFor(id)));
  } catch (e) {
    console.error('[omi/confirm] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'confirm failed' });
  }
});

app.get('/api/omi/transcripts', (_req, res) => {
  try {
    const transcripts = listRecentTranscripts(50);
    res.json(transcripts);
  } catch (e) {
    console.error('[omi/transcripts] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to list transcripts' });
  }
});

// GET /api/omi/transcripts/:date — full text for a specific day
app.get('/api/omi/transcripts/:date', (req, res) => {
  const text = readTranscriptByDate(req.params.date);
  if (text === null) return res.status(404).json({ error: 'no transcript for that date' });
  res.json({ date: req.params.date, text });
});

// ============================================================================
// /api/vision — Frame photo analysis via Ollama vision API
// ============================================================================
import { analyzeFramePhoto, type FrameAnalysis } from './vision.js';

// Store recent vision analyses in memory (simple ring buffer of 50)
interface VisionAnalysisRecord {
  id: string;
  hiveId: string | null;
  timestamp: string;
  analysis: FrameAnalysis;
}
const recentVisionAnalyses: VisionAnalysisRecord[] = [];
const MAX_RECENT_ANALYSES = 50;

function normalizeImage(image: string): string {
  // Accept either a data URL or raw base64; pass through to vision module.
  return image;
}

app.post('/api/vision/analyze', async (req, res) => {
  try {
    const { image, hiveId } = req.body || {};
    if (typeof image !== 'string' || !image.trim()) {
      return res.status(400).json({ error: 'image (string, base64 data URL or raw base64) is required' });
    }

    // Look up hive name for better prompt context
    let hiveName: string | undefined;
    if (hiveId) {
      const hiveRow = db.prepare('SELECT name FROM hives WHERE id = ?').get(hiveId) as { name: string } | undefined;
      if (hiveRow) hiveName = hiveRow.name;
    }

    const analysis = await analyzeFramePhoto(normalizeImage(image), hiveName);
    const timestamp = new Date().toISOString();
    const record: VisionAnalysisRecord = {
      id: genId('va'),
      hiveId: hiveId ?? null,
      timestamp,
      analysis,
    };
    recentVisionAnalyses.unshift(record);
    if (recentVisionAnalyses.length > MAX_RECENT_ANALYSES) {
      recentVisionAnalyses.length = MAX_RECENT_ANALYSES;
    }

    res.json({ analysis, hiveId: hiveId ?? null, timestamp });
  } catch (e) {
    console.error('[vision/analyze] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'vision analysis failed' });
  }
});

app.post('/api/vision/analyze-and-create', async (req, res) => {
  try {
    const { image, hiveId, notes } = req.body || {};
    if (typeof image !== 'string' || !image.trim()) {
      return res.status(400).json({ error: 'image (string, base64) is required' });
    }
    if (!hiveId) {
      return res.status(400).json({ error: 'hiveId is required' });
    }
    const hiveExists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!hiveExists) {
      return res.status(404).json({ error: 'hive not found' });
    }

    const hiveRow = db.prepare('SELECT name FROM hives WHERE id = ?').get(hiveId) as { name: string };
    const analysis = await analyzeFramePhoto(normalizeImage(image), hiveRow.name);

    // Map analysis → inspection fields
    const layingMap: Record<string, 'excellent' | 'good' | 'fair' | 'poor' | 'none'> = {
      solid: 'excellent',
      spotty: 'poor',
      patchy: 'fair',
      none: 'none',
      unknown: 'none',
    };
    const queenLayingPattern = layingMap[analysis.broodPattern] ?? 'none';

    // Derive honey/pollen store levels from ratios
    function ratioToStore(r: number): 'none' | 'low' | 'medium' | 'high' {
      if (r >= 0.5) return 'high';
      if (r >= 0.25) return 'medium';
      if (r >= 0.05) return 'low';
      return 'none';
    }
    const honeyStores = ratioToStore(analysis.honeyRatio);
    const pollenStores = ratioToStore(analysis.pollenRatio);

    // Build concerns from diseases + pests + analysis concerns
    const concerns: { type: string; count?: number; note?: string }[] = [];
    for (const d of analysis.diseases) {
      concerns.push({
        type: d.type,
        note: d.note + (d.confidence ? ' (confidence: ' + d.confidence + ')' : ''),
      });
    }
    for (const p of analysis.pests) {
      concerns.push({
        type: p.type,
        count: p.count,
        note: p.note,
      });
    }
    for (const c of analysis.concerns) {
      concerns.push({ type: c.type, note: c.note });
    }

    // Build notes: overall assessment + optional user notes
    const notesParts: string[] = [];
    if (notes && typeof notes === 'string' && notes.trim()) {
      notesParts.push(notes.trim());
    }
    notesParts.push('[AI Frame Analysis] ' + analysis.overallAssessment);
    if (analysis.recommendations.length > 0) {
      notesParts.push('Recommendations: ' + analysis.recommendations.join('; '));
    }
    if (analysis.queenSpotted) {
      notesParts.push('Queen spotted: ' + analysis.queenLocation);
    }
    const inspectionNotes = notesParts.join('\n\n');

    // Calculate health
    const health = calculateHealth({
      queenPresent: analysis.queenSpotted,
      queenCells: false,
      queenLayingPattern,
      eggsPresent: analysis.eggsVisible,
      larvaePresent: analysis.larvaeVisible,
      cappedBrood: analysis.cappedBroodPresent,
      temperament: 'normal',
      honeyStores,
      pollenStores,
      populationSize: 'none', // not determinable from a single frame photo
      concerns,
      colonyDead: false,
    });

    // Insert inspection
    const id = genId('insp');
    db.prepare(
      'INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      hiveId,
      new Date().toISOString(),
      analysis.queenSpotted ? 1 : 0,
      analysis.queenCellsVisible ? 1 : 0, // queen cells detected by vision model
      queenLayingPattern,
      analysis.eggsVisible ? 1 : 0,
      analysis.larvaeVisible ? 1 : 0,
      analysis.cappedBroodPresent ? 1 : 0,
      'normal', // temperament not determinable from photo
      honeyStores,
      pollenStores,
      'none', // population not determinable from single frame
      0,
      health,
      1, // auto-calculated
      0, // not dead
      inspectionNotes,
      JSON.stringify([]),
    );

    // Insert concerns
    if (concerns.length > 0) {
      const insConcern = db.prepare(
        'INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)',
      );
      for (const c of concerns) {
        if (!c.type) continue;
        insConcern.run(genId('c'), id, c.type, c.count ?? null, c.note ?? null);
      }
    }

    // Save the original frame photo to media_items so it's viewable from the inspection
    try {
      const photoId = genId('media');
      db.prepare(
        'INSERT INTO media_items (id, inspectionId, hiveId, type, dataUrl, timestamp, label, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(photoId, id, hiveId, 'photo', normalizeImage(image), new Date().toISOString(), 'AI Frame Analysis Photo', null);
      // Also link it via photoUrls on the inspection for quick access
      db.prepare('UPDATE inspections SET photoUrls = ? WHERE id = ?').run(
        JSON.stringify([photoId]),
        id,
      );
    } catch (mediaErr) {
      console.error('[vision/analyze-and-create] media save error:', mediaErr);
    }

    // Update hive health status
    db.prepare('UPDATE hives SET healthStatus = ? WHERE id = ?').run(health, hiveId);

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as InspectionRow;
    const inspection = mapInspection(row, getConcernsFor(id));
    // Attach media
    const mediaRows = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? ORDER BY timestamp DESC').all(id) as any[];
    inspection.media = mediaRows.map(mapMedia);

    // Store in recent analyses
    const record: VisionAnalysisRecord = {
      id: genId('va'),
      hiveId,
      timestamp: new Date().toISOString(),
      analysis,
    };
    recentVisionAnalyses.unshift(record);
    if (recentVisionAnalyses.length > MAX_RECENT_ANALYSES) {
      recentVisionAnalyses.length = MAX_RECENT_ANALYSES;
    }

    res.status(201).json({ inspection, analysis });
  } catch (e) {
    console.error('[vision/analyze-and-create] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'vision analysis+create failed' });
  }
});

app.get('/api/vision/analyses', (_req, res) => {
  res.json(recentVisionAnalyses);
});

// ============================================================================
// /api/vision/varroa — Varroa sticky board AI counter
// ============================================================================
import { analyzeStickyBoard, type VarroaCount } from './varroa.js';
import { calculateSwarmRisk, calculateSwarmRiskAll, type SwarmRiskAssessment } from './swarm.js';

app.post('/api/vision/varroa', async (req, res) => {
  try {
    const { image, hiveId } = req.body || {};
    if (typeof image !== 'string' || !image.trim()) {
      return res.status(400).json({ error: 'image (base64 string) is required' });
    }
    if (!hiveId) {
      return res.status(400).json({ error: 'hiveId is required' });
    }
    const count = await analyzeStickyBoard(image);
    res.json({ count, hiveId, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('[vision/varroa] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'varroa analysis failed' });
  }
});

app.post('/api/vision/varroa/save', (req, res) => {
  try {
    const { image, hiveId, miteCount, date } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    if (typeof miteCount !== 'number') return res.status(400).json({ error: 'miteCount (number) is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const inspId = genId('insp');
    const inspDate = date ?? new Date().toISOString();
    const concernNote = 'Varroa sticky board count: ' + miteCount + ' mites.';

    db.prepare(
      'INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      inspId,
      hiveId,
      inspDate,
      0, // queenPresent (unknown)
      0,
      'none',
      0,
      0,
      0,
      'normal',
      'none',
      'none',
      'none',
      0,
      'fair', // placeholder health
      1, // auto-calculated
      0,
      concernNote,
      image ? JSON.stringify([image]) : JSON.stringify([]),
    );

    // Insert a varroa concern with the mite count
    db.prepare(
      'INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)',
    ).run(genId('c'), inspId, 'varroa', miteCount, concernNote);

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspId) as InspectionRow;
    res.status(201).json(mapInspection(row, getConcernsFor(inspId)));
  } catch (e) {
    console.error('[vision/varroa/save] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'save failed' });
  }
});

app.get('/api/varroa/history/:hiveId', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC')
      .all(req.params.hiveId) as InspectionRow[];
    const history: any[] = [];
    for (const r of rows) {
      const concerns = getConcernsFor(r.id) as ConcernRowX[];
      const varroa = concerns.find((c) => c.type.toLowerCase() === 'varroa');
      if (varroa) {
        history.push({
          inspectionId: r.id,
          hiveId: r.hiveId,
          date: r.date,
          miteCount: varroa.count ?? 0,
          note: varroa.note ?? '',
          healthStatus: r.healthStatus,
        });
      }
    }
    res.json(history);
  } catch (e) {
    console.error('[varroa/history] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'history failed' });
  }
});

interface ConcernRowX {
  id: string;
  inspectionId: string;
  type: string;
  count: number | null;
  note: string | null;
}

// ============================================================================
// /api/swarm/risk — Swarm risk assessment
// ============================================================================
app.get('/api/swarm/risk/:hiveId', async (req, res) => {
  try {
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(req.params.hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });
    const assessment = await calculateSwarmRisk(req.params.hiveId);
    res.json(assessment);
  } catch (e) {
    console.error('[swarm/risk/:hiveId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'swarm risk failed' });
  }
});

app.get('/api/swarm/risk', async (_req, res) => {
  try {
    const assessments = await calculateSwarmRiskAll();
    res.json(assessments);
  } catch (e) {
    console.error('[swarm/risk] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'swarm risk failed' });
  }
});

// ============================================================================
// /api/schedule — Smart inspection scheduler
// ============================================================================
import { getInspectionSchedule, getHiveSchedule } from './scheduler.js';

app.get('/api/schedule', async (_req, res) => {
  try {
    const recs = await getInspectionSchedule();
    res.json(recs);
  } catch (e) {
    console.error('[schedule] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'schedule failed' });
  }
});

app.get('/api/schedule/:hiveId', async (req, res) => {
  try {
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(req.params.hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });
    const rec = await getHiveSchedule(req.params.hiveId);
    res.json(rec);
  } catch (e) {
    console.error('[schedule/:hiveId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'schedule failed' });
  }
});

// ============================================================================
// /api/inspect — Free-text inspection parser (Buzz, no voice required)
// ============================================================================
app.post('/api/inspect/parse', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }
    const hiveRows = db.prepare('SELECT id, name FROM hives').all() as { id: string; name: string }[];
    const parsed = await parseFreeTextToInspection(text, hiveRows);
    res.json({ parsed, raw: text });
  } catch (e) {
    console.error('[inspect/parse] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'parse failed' });
  }
});

app.post('/api/inspect/confirm', (req, res) => {
  try {
    const { parsed, hiveId } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const p: ParsedInspection = parsed || {};
    const health = calculateHealth({
      queenPresent: p.queenPresent,
      queenCells: p.queenCells,
      queenLayingPattern: p.queenLayingPattern,
      eggsPresent: p.eggsPresent,
      larvaePresent: p.larvaePresent,
      cappedBrood: p.cappedBrood,
      temperament: p.temperament,
      honeyStores: p.honeyStores,
      pollenStores: p.pollenStores,
      populationSize: p.populationSize,
      concerns: p.concerns ?? [],
      colonyDead: false,
    });

    const id = genId('insp');
    db.prepare(
      `INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      hiveId,
      new Date().toISOString(),
      p.queenPresent ? 1 : 0,
      p.queenCells ? 1 : 0,
      p.queenLayingPattern ?? 'none',
      p.eggsPresent ? 1 : 0,
      p.larvaePresent ? 1 : 0,
      p.cappedBrood ? 1 : 0,
      p.temperament ?? 'normal',
      p.honeyStores ?? 'none',
      p.pollenStores ?? 'none',
      p.populationSize ?? 'none',
      0,
      health,
      1, // auto-calculated
      0, // not dead
      p.notes ?? '',
      JSON.stringify([]),
    );

    // Insert concerns
    if (Array.isArray(p.concerns)) {
      const insConcern = db.prepare(
        `INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const c of p.concerns) {
        if (!c.type) continue;
        insConcern.run(genId('c'), id, c.type, c.count ?? null, c.note ?? null);
      }
    }

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as InspectionRow;
    // Update hive health status to match latest inspection
    db.prepare('UPDATE hives SET healthStatus = ? WHERE id = ?').run(health, hiveId);
    res.status(201).json(mapInspection(row, getConcernsFor(id)));
  } catch (e) {
    console.error('[inspect/confirm] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'confirm failed' });
  }
});

// ============================================================================
// /api/trending — Hive health trending
// ============================================================================
import { getHealthTrend, getAllHealthTrends } from './trending.js';

app.get('/api/trending/:hiveId', (req, res) => {
  try {
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(req.params.hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });
    const trend = getHealthTrend(req.params.hiveId);
    res.json(trend);
  } catch (e) {
    console.error('[trending/:hiveId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'trending failed' });
  }
});

app.get('/api/trending', (_req, res) => {
  try {
    const trends = getAllHealthTrends();
    res.json(trends);
  } catch (e) {
    console.error('[trending] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'trending failed' });
  }
});

// ============================================================================
// /api/treatment — Treatment recommender
// ============================================================================
import { getTreatmentRecommendation, getAllTreatmentRecommendations } from './treatment.js';

app.get('/api/treatment/:hiveId', (req, res) => {
  try {
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(req.params.hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });
    const rec = getTreatmentRecommendation(req.params.hiveId);
    res.json(rec);
  } catch (e) {
    console.error('[treatment/:hiveId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'treatment failed' });
  }
});

app.get('/api/treatment', (_req, res) => {
  try {
    const recs = getAllTreatmentRecommendations();
    res.json(recs);
  } catch (e) {
    console.error('[treatment] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'treatment failed' });
  }
});

// ============================================================================
// /api/forage — Forage & nectar flow forecast
// ============================================================================
import { getForageForecast, getForageForecastWithPreview } from './forage.js';

app.get('/api/forage', (_req, res) => {
  try {
    const { current, next } = getForageForecastWithPreview();
    res.json({ current, next });
  } catch (e) {
    console.error('[forage] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'forage failed' });
  }
});

app.get('/api/forage/:month', (req, res) => {
  try {
    const m = Number(req.params.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'month must be an integer 1-12' });
    }
    const forecast = getForageForecast(m);
    res.json(forecast);
  } catch (e) {
    console.error('[forage/:month] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'forage failed' });
  }
});

// ============================================================================
// /api/acoustics — Hive acoustics analysis
// ============================================================================
import { analyzeAcoustics, type AcousticAnalysis } from './acoustics.js';

app.post('/api/acoustics/analyze', async (req, res) => {
  try {
    const { audio, duration, hiveId, description } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const analysis = await analyzeAcoustics({ hiveId, audio, duration, description });
    res.json(analysis);
  } catch (e) {
    console.error('[acoustics/analyze] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'acoustic analysis failed' });
  }
});

app.post('/api/acoustics/save', (req, res) => {
  try {
    const { hiveId, analysis, notes } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    if (!analysis) return res.status(400).json({ error: 'analysis is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const a: AcousticAnalysis = analysis;
    const inspId = genId('insp');
    const concernNote = 'Acoustic analysis: ' + a.interpretation + ' (confidence: ' + a.confidence + '). ' + a.notes;
    const inspectionNotes = (notes ? notes + '\n\n' : '') + '[Acoustic Analysis]\n' +
      'Interpretation: ' + a.interpretation + '\n' +
      'Confidence: ' + a.confidence + '\n' +
      'Frequency: ' + a.frequency + '\n' +
      'Pattern: ' + a.pattern + '\n' +
      'Recommendations: ' + (a.recommendations || []).join('; ');

    db.prepare(
      'INSERT INTO inspections (id, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      inspId,
      hiveId,
      new Date().toISOString(),
      0,
      0,
      'none',
      0,
      0,
      0,
      a.interpretation === 'stressed' || a.interpretation === 'queenless' ? 'agitated' : 'normal',
      'none',
      'none',
      'none',
      0,
      a.interpretation === 'queenless' ? 'poor' : a.interpretation === 'stressed' ? 'fair' : 'good',
      1,
      0,
      inspectionNotes,
      JSON.stringify([]),
    );

    // Insert an acoustic concern
    db.prepare(
      'INSERT INTO concerns (id, inspectionId, type, count, note) VALUES (?, ?, ?, ?, ?)',
    ).run(genId('c'), inspId, 'acoustic', null, concernNote);

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspId) as InspectionRow;
    res.status(201).json(mapInspection(row, getConcernsFor(inspId)));
  } catch (e) {
    console.error('[acoustics/save] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'save failed' });
  }
});

app.get('/api/acoustics/history/:hiveId', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC')
      .all(req.params.hiveId) as InspectionRow[];
    const history: any[] = [];
    for (const r of rows) {
      const concerns = getConcernsFor(r.id) as ConcernRowX[];
      const acoustic = concerns.find((c) => c.type.toLowerCase() === 'acoustic');
      if (acoustic) {
        history.push({
          inspectionId: r.id,
          hiveId: r.hiveId,
          date: r.date,
          note: acoustic.note ?? '',
          healthStatus: r.healthStatus,
          notes: r.notes,
        });
      }
    }
    res.json(history);
  } catch (e) {
    console.error('[acoustics/history] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'history failed' });
  }
});

// ============================================================================
// /api/queen — Queen ID tracking
// ============================================================================
import {
  getQueenStatus,
  getAllQueenStatuses,
  recordQueen,
  queenColorForYear,
} from './queenTracking.js';

app.get('/api/queen/all', (_req, res) => {
  try {
    res.json(getAllQueenStatuses());
  } catch (e) {
    console.error('[queen/all] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'queen status failed' });
  }
});

app.get('/api/queen/color/:year', (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'year must be an integer' });
  res.json({ year, color: queenColorForYear(year) });
});

app.get('/api/queen/:hiveId', (req, res) => {
  try {
    const status = getQueenStatus(req.params.hiveId);
    if (!status) return res.status(404).json({ error: 'hive not found' });
    res.json(status);
  } catch (e) {
    console.error('[queen/:hiveId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'queen status failed' });
  }
});

app.post('/api/queen/record', (req, res) => {
  try {
    const { hiveId, queenColor, queenYear, imageUrls, notes, source } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    if (!queenColor) return res.status(400).json({ error: 'queenColor is required' });
    if (typeof queenYear !== 'number') return res.status(400).json({ error: 'queenYear (number) is required' });
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const record = recordQueen({ hiveId, queenColor, queenYear, imageUrls, notes, source });
    res.status(201).json(record);
  } catch (e) {
    console.error('[queen/record] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'record failed' });
  }
});

// ============================================================================
// /api/outlier — Apiary outlier detection
// ============================================================================
import { getOutlierReport, getAllOutlierReports, type OutlierReport } from './outlier.js';

app.get('/api/outlier', (_req, res) => {
  try {
    res.json(getAllOutlierReports());
  } catch (e) {
    console.error('[outlier] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'outlier detection failed' });
  }
});

app.get('/api/outlier/:apiaryId', (req, res) => {
  try {
    const report = getOutlierReport(req.params.apiaryId);
    if (!report) return res.status(404).json({ error: 'apiary not found' });
    res.json(report);
  } catch (e) {
    console.error('[outlier/:apiaryId] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'outlier detection failed' });
  }
});

// ============================================================================
// /api/vision/reconstruct — Multi-photo colony reconstruction
// ============================================================================
import { reconstructColony, type FrameReconstruction } from './reconstruction.js';

app.post('/api/vision/reconstruct', async (req, res) => {
  try {
    const { images, hiveId } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'images (string[]) is required' });
    }
    const exists = db.prepare('SELECT 1 FROM hives WHERE id = ?').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const result = await reconstructColony(images, hiveId);
    res.json(result);
  } catch (e) {
    console.error('[vision/reconstruct] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'reconstruction failed' });
  }
});

// ============================================================================
// /api/chat — Buzz the beekeeper AI (Ollama glm-5.2:cloud)
// ============================================================================
const CHAT_URL = 'http://localhost:11434/v1/chat/completions';
const CHAT_MODEL = 'glm-5.2:cloud';
const CHAT_SYSTEM_PROMPT =
  'You are Buzz, a UGA Master Craftsman Beekeeper with decades of experience. ' +
  'You are helpful, concise, and practical. You know Georgia beekeeping, seasonal management, ' +
  'and Integrated Pest Management. Answer in a friendly, expert tone. Keep responses under 200 words unless asked for detail.';

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const payload = {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...messages.filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any) => ({ role: m.role, content: m.content })),
      ],
      stream: false,
      temperature: 0.7,
    };

    const ollamaResp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!ollamaResp.ok) {
      const txt = await ollamaResp.text().catch(() => '');
      console.error('[chat] Ollama error:', ollamaResp.status, txt.slice(0, 200));
      return res.status(ollamaResp.status).json({ error: `Ollama ${ollamaResp.status}: ${txt.slice(0, 200)}` });
    }

    const data = await ollamaResp.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) {
      return res.status(500).json({ error: 'Ollama returned empty response' });
    }

    res.json({ content, model: CHAT_MODEL });
  } catch (e) {
    console.error('[chat] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'chat failed' });
  }
});

// ============================================================================
// /api/health check & 404
// ============================================================================
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ============================================================================
// Start
// ============================================================================
const PORT = Number(process.env.PORT || 3001);
const HOST = '127.0.0.1'; // localhost only — Tailscale Funnel proxy reaches it locally
app.listen(PORT, HOST, () => {
  console.log(`🐝 BeeTree API listening on http://${HOST}:${PORT}`);
  if (AUTH_DISABLED) {
    console.log('⚠️  AUTH DISABLED (BEETREE_DISABLE_AUTH=1) — NOT secure for internet exposure!');
  } else if (!process.env.BEETREE_API_KEY) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 API KEY (auto-generated, set BEETREE_API_KEY to override):');
    console.log(`   ${API_KEY}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } else {
    console.log('🔑 API key loaded from BEETREE_API_KEY env var.');
  }
});

// Graceful shutdown for OpenTelemetry SDK
process.on('SIGTERM', () => { void stopTelemetry(); process.exit(0); });
process.on('SIGINT', () => { void stopTelemetry(); process.exit(0); });