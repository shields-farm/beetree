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
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
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
  now,
  cowSupersede,
  type ApiaryRow,
  type HiveRow,
  type BoxRow,
  type FrameSlotRow,
  type InspectionRow,
} from './db.js';

initSchema();

// No auto-seed — fresh installs start empty. Setup wizard handles initial data.

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
    return res.status(401).json({ error: 'Authentication required. Send Authorization: Bearer *** header.' });
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
  'https://beetree-host.tailnet-id.ts.net:8443',
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
  const nowTs = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || nowTs > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: nowTs + RATE_WINDOW });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      _res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return;
    }
  }
  next();
});

// Apply auth to all /api routes except health, key (local-only), and setup/status
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path === '/setup/status') return next();
  if (req.path === '/key') {
    // Only allow from localhost
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1')) {
      return next();
    }
    return res.status(403).json({ error: 'Key retrieval only available from localhost' });
  }
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
interface HiveNameRow { entity_id: string; name: string; }

function updateGaugesFromDB(): void {
  try {
    const hiveCount = (db.prepare('SELECT COUNT(*) as c FROM hives WHERE superseded_by IS NULL').get() as { c: number }).c;
    const inspCount = (db.prepare('SELECT COUNT(*) as c FROM inspections WHERE superseded_by IS NULL').get() as { c: number }).c;
    const sensorCount = (db.prepare('SELECT COUNT(*) as c FROM sensors WHERE superseded_by IS NULL').get() as { c: number }).c;
    console.log(`[telemetry] gauge refresh — hives: ${hiveCount}, inspections: ${inspCount}, sensors: ${sensorCount}`);
  } catch (e) {
    console.error('[telemetry] gauge refresh error:', e);
  }
}

// Register observable callbacks that read from DB when metrics are scraped/exported.
hiveCountGauge.addCallback((result) => {
  try {
    const c = (db.prepare('SELECT COUNT(*) as c FROM hives WHERE superseded_by IS NULL').get() as { c: number }).c;
    result.observe(c);
  } catch { /* DB not ready */ }
});

inspectionCountGauge.addCallback((result) => {
  try {
    const c = (db.prepare('SELECT COUNT(*) as c FROM inspections WHERE superseded_by IS NULL').get() as { c: number }).c;
    result.observe(c);
  } catch { /* DB not ready */ }
});

sensorTemperatureGauge.addCallback((result) => {
  try {
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors WHERE superseded_by IS NULL').all() as SensorRow[];
    const hives = db.prepare('SELECT entity_id, name FROM hives WHERE superseded_by IS NULL').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.entity_id, h.name]));
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
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors WHERE superseded_by IS NULL').all() as SensorRow[];
    const hives = db.prepare('SELECT entity_id, name FROM hives WHERE superseded_by IS NULL').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.entity_id, h.name]));
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
    const sensors = db.prepare('SELECT id, deviceId, name, hiveId, latestReading FROM sensors WHERE superseded_by IS NULL').all() as SensorRow[];
    const hives = db.prepare('SELECT entity_id, name FROM hives WHERE superseded_by IS NULL').all() as HiveNameRow[];
    const hiveNameMap = new Map(hives.map((h) => [h.entity_id, h.name]));
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
setInterval(() => {
  updateGaugesFromDB();
}, 30_000);

// ============================================================================
// Helper: get hive name by entity_id
// ============================================================================
function getHiveNameByEntityId(entityId: string): string | undefined {
  const row = db.prepare('SELECT name FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(entityId) as { name: string } | undefined;
  return row?.name;
}

// ============================================================================
// /api/apiaries
// ============================================================================
app.get('/api/apiaries', (_req, res) => {
  const rows = db.prepare('SELECT * FROM apiaries WHERE superseded_by IS NULL').all() as ApiaryRow[];
  res.json(rows.map(mapApiary));
});

app.get('/api/apiaries/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as ApiaryRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapApiary(row));
});

app.post('/api/apiaries', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('apiary');
  const rowId = genId('apiary');
  db.prepare(`INSERT INTO apiaries (id, entity_id, version, superseded_by, superseded_at, name, location_lat, location_lng, address, notes) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?)`)
    .run(rowId, entityId, b.name ?? '', b.location?.lat ?? null, b.location?.lng ?? null, b.address ?? null, b.notes ?? null);
  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(rowId) as ApiaryRow;
  res.status(201).json(mapApiary(row));
});

app.put('/api/apiaries/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM apiaries WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });

  const newRowId = cowSupersede('apiaries', entityId, (old) => ({
    name: b.name ?? '',
    location_lat: b.location?.lat ?? null,
    location_lng: b.location?.lng ?? null,
    address: b.address ?? null,
    notes: b.notes ?? null,
  }));

  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(newRowId) as ApiaryRow;
  res.json(mapApiary(row));
});

app.delete('/api/apiaries/:id', (req, res) => {
  // Delete all versions of this entity
  db.prepare('DELETE FROM apiaries WHERE entity_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// History & revert
app.get('/api/apiaries/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? ORDER BY version DESC').all(req.params.id) as ApiaryRow[];
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows.map((r) => ({ ...mapApiary(r), supersededBy: r.superseded_by, supersededAt: r.superseded_at })));
});

app.post('/api/apiaries/:id/revert', (req, res) => {
  const entityId = req.params.id;
  const targetVersion = Number(req.query.version);
  if (!targetVersion) return res.status(400).json({ error: 'version query param required' });

  const target = db.prepare('SELECT * FROM apiaries WHERE entity_id = ? AND version = ?').get(entityId, targetVersion) as ApiaryRow | undefined;
  if (!target) return res.status(404).json({ error: `version ${targetVersion} not found` });

  const newRowId = cowSupersede('apiaries', entityId, () => ({
    name: target.name,
    location_lat: target.location_lat,
    location_lng: target.location_lng,
    address: target.address,
    notes: target.notes,
  }));

  const row = db.prepare('SELECT * FROM apiaries WHERE id = ?').get(newRowId) as ApiaryRow;
  res.json(mapApiary(row));
});

// ============================================================================
// /api/hives  (includes boxes + frame_slots)
// ============================================================================
function getHiveBoxes(hiveEntityId: string): BoxRow[] {
  return db.prepare('SELECT * FROM boxes WHERE hiveId = ? AND superseded_by IS NULL').all(hiveEntityId) as BoxRow[];
}
function getAllFrameSlots(): FrameSlotRow[] {
  return db.prepare('SELECT * FROM frame_slots WHERE superseded_by IS NULL').all() as FrameSlotRow[];
}

app.get('/api/hives', (_req, res) => {
  const rows = db.prepare('SELECT * FROM hives WHERE superseded_by IS NULL').all() as HiveRow[];
  const boxes = db.prepare('SELECT * FROM boxes WHERE superseded_by IS NULL').all() as BoxRow[];
  const slots = getAllFrameSlots();
  res.json(rows.map((r) => mapHive(r, boxes, slots)));
});

app.get('/api/hives/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as HiveRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const boxes = getHiveBoxes(row.entity_id);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE superseded_by IS NULL AND boxId IN (SELECT entity_id FROM boxes WHERE hiveId = ? AND superseded_by IS NULL)').all(row.entity_id) as FrameSlotRow[];
  res.json(mapHive(row, boxes, slots));
});

app.post('/api/hives', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('hive');
  const rowId = genId('hive');
  const loc = b.location || {};
  db.prepare(`INSERT INTO hives (id, entity_id, version, superseded_by, superseded_at, apiaryId, name, type, healthStatus, notes, createdAt, location_lat, location_lng, location_accuracy, location_pinnedAt, location_label, sensorIds) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      rowId,
      entityId,
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
  const insBox = db.prepare(`INSERT INTO boxes (id, entity_id, version, superseded_by, superseded_at, hiveId, type, "index", sensorIds) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`);
  const insSlot = db.prepare(`INSERT INTO frame_slots (id, entity_id, version, superseded_by, superseded_at, boxId, position, content) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?)`);
  const boxes = b.boxes || [];
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const boxEntityId = box.id || `${entityId}-box-${i}`;
    const boxRowId = genId('box');
    insBox.run(boxRowId, boxEntityId, entityId, box.type, i, JSON.stringify(box.sensorIds || []));
    const frames = box.frames || [];
    for (const f of frames) {
      insSlot.run(genId('fs'), genId('fs'), boxEntityId, f.position, f.content || 'empty');
    }
  }

  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(rowId) as HiveRow;
  const hBoxes = getHiveBoxes(entityId);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE superseded_by IS NULL AND boxId IN (SELECT entity_id FROM boxes WHERE hiveId = ? AND superseded_by IS NULL)').all(entityId) as FrameSlotRow[];
  res.status(201).json(mapHive(row, hBoxes, slots));
});

app.put('/api/hives/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });
  const loc = b.location || {};

  const newRowId = cowSupersede('hives', entityId, () => ({
    apiaryId: b.apiaryId,
    name: b.name ?? '',
    type: b.type ?? 'langstroth-10',
    healthStatus: b.healthStatus ?? 'good',
    notes: b.notes ?? null,
    createdAt: b.createdAt ?? new Date().toISOString(),
    location_lat: loc.lat ?? null,
    location_lng: loc.lng ?? null,
    location_accuracy: loc.accuracy ?? null,
    location_pinnedAt: loc.pinnedAt ?? null,
    location_label: loc.label ?? null,
    sensorIds: JSON.stringify(b.sensorIds || []),
  }));

  // Replace boxes + frame_slots if provided
  if (Array.isArray(b.boxes)) {
    // Supersede existing boxes + frame_slots
    const oldBoxes = db.prepare('SELECT entity_id FROM boxes WHERE hiveId = ? AND superseded_by IS NULL').all(entityId) as { entity_id: string }[];
    for (const ob of oldBoxes) {
      // Supersede frame slots of this box
      const oldSlots = db.prepare('SELECT id, entity_id FROM frame_slots WHERE boxId = ? AND superseded_by IS NULL').all(ob.entity_id) as { id: string; entity_id: string }[];
      for (const os of oldSlots) {
        const ts = now();
        db.prepare('UPDATE frame_slots SET superseded_by = ?, superseded_at = ? WHERE id = ?').run(genId('fs'), ts, os.id);
      }
      const ts = now();
      db.prepare('UPDATE boxes SET superseded_by = ?, superseded_at = ? WHERE entity_id = ? AND superseded_by IS NULL').run(genId('box'), ts, ob.entity_id);
    }
    // Insert new boxes + frame_slots
    const insBox = db.prepare(`INSERT INTO boxes (id, entity_id, version, superseded_by, superseded_at, hiveId, type, "index", sensorIds) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`);
    const insSlot = db.prepare(`INSERT INTO frame_slots (id, entity_id, version, superseded_by, superseded_at, boxId, position, content) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?)`);
    for (let i = 0; i < b.boxes.length; i++) {
      const box = b.boxes[i];
      const boxEntityId = box.id || `${entityId}-box-${i}`;
      const boxRowId = genId('box');
      insBox.run(boxRowId, boxEntityId, entityId, box.type, i, JSON.stringify(box.sensorIds || []));
      const frames = box.frames || [];
      for (const f of frames) {
        insSlot.run(genId('fs'), genId('fs'), boxEntityId, f.position, f.content || 'empty');
      }
    }
  }

  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(newRowId) as HiveRow;
  const hBoxes = getHiveBoxes(entityId);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE superseded_by IS NULL AND boxId IN (SELECT entity_id FROM boxes WHERE hiveId = ? AND superseded_by IS NULL)').all(entityId) as FrameSlotRow[];
  res.json(mapHive(row, hBoxes, slots));
});

app.delete('/api/hives/:id', (req, res) => {
  // Delete all versions of this hive + associated boxes/frame_slots
  db.prepare('DELETE FROM frame_slots WHERE boxId IN (SELECT entity_id FROM boxes WHERE hiveId = ?)').run(req.params.id);
  db.prepare('DELETE FROM boxes WHERE hiveId = ?').run(req.params.id);
  db.prepare('DELETE FROM hives WHERE entity_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// History & revert
app.get('/api/hives/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM hives WHERE entity_id = ? ORDER BY version DESC').all(req.params.id) as HiveRow[];
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows.map((r) => ({ ...mapHive(r, [], []), supersededBy: r.superseded_by, supersededAt: r.superseded_at })));
});

app.post('/api/hives/:id/revert', (req, res) => {
  const entityId = req.params.id;
  const targetVersion = Number(req.query.version);
  if (!targetVersion) return res.status(400).json({ error: 'version query param required' });

  const target = db.prepare('SELECT * FROM hives WHERE entity_id = ? AND version = ?').get(entityId, targetVersion) as HiveRow | undefined;
  if (!target) return res.status(404).json({ error: `version ${targetVersion} not found` });

  const newRowId = cowSupersede('hives', entityId, () => ({
    apiaryId: target.apiaryId,
    name: target.name,
    type: target.type,
    healthStatus: target.healthStatus,
    notes: target.notes,
    createdAt: target.createdAt,
    location_lat: target.location_lat,
    location_lng: target.location_lng,
    location_accuracy: target.location_accuracy,
    location_pinnedAt: target.location_pinnedAt,
    location_label: target.location_label,
    sensorIds: target.sensorIds,
  }));

  const row = db.prepare('SELECT * FROM hives WHERE id = ?').get(newRowId) as HiveRow;
  const hBoxes = getHiveBoxes(entityId);
  const slots = db.prepare('SELECT * FROM frame_slots WHERE superseded_by IS NULL AND boxId IN (SELECT entity_id FROM boxes WHERE hiveId = ? AND superseded_by IS NULL)').all(entityId) as FrameSlotRow[];
  res.json(mapHive(row, hBoxes, slots));
});

// ============================================================================
// /api/inspections  (includes concerns)
// ============================================================================
function getConcernsFor(inspectionId: string) {
  return db.prepare('SELECT * FROM concerns WHERE inspectionId = ? AND superseded_by IS NULL').all(inspectionId) as any[];
}

app.get('/api/inspections', (_req, res) => {
  const rows = db.prepare('SELECT * FROM inspections WHERE superseded_by IS NULL').all() as InspectionRow[];
  res.json(rows.map((r) => {
    const insp = mapInspection(r, getConcernsFor(r.entity_id));
    const media = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? AND superseded_by IS NULL ORDER BY timestamp DESC').all(r.entity_id) as any[];
    insp.media = media.map(mapMedia);
    return insp;
  }));
});

app.get('/api/inspections/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as InspectionRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const insp = mapInspection(row, getConcernsFor(row.entity_id));
  const media = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? AND superseded_by IS NULL ORDER BY timestamp DESC').all(row.entity_id) as any[];
  insp.media = media.map(mapMedia);
  res.json(insp);
});

app.get('/api/hives/:hiveId/inspections', (req, res) => {
  const rows = db.prepare('SELECT * FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC').all(req.params.hiveId) as InspectionRow[];
  res.json(rows.map((r) => mapInspection(r, getConcernsFor(r.entity_id))));
});

app.post('/api/inspections', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('insp');
  const rowId = genId('insp');
  db.prepare(`INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      rowId,
      entityId,
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
    const insConcern = db.prepare(`INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`);
    for (const c of b.concerns) {
      const concernEntityId = c.id || genId('c');
      insConcern.run(genId('c'), concernEntityId, entityId, c.type, c.count ?? null, c.note ?? null);
    }
  }

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
  res.status(201).json(mapInspection(row, getConcernsFor(entityId)));
});

app.put('/api/inspections/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM inspections WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });

  const newRowId = cowSupersede('inspections', entityId, () => ({
    hiveId: b.hiveId,
    date: b.date ?? new Date().toISOString(),
    queenPresent: b.queenPresent ? 1 : 0,
    queenCells: b.queenCells ? 1 : 0,
    queenLayingPattern: b.queenLayingPattern ?? 'none',
    eggsPresent: b.eggsPresent ? 1 : 0,
    larvaePresent: b.larvaePresent ? 1 : 0,
    cappedBrood: b.cappedBrood ? 1 : 0,
    temperament: b.temperament ?? 'normal',
    honeyStores: b.honeyStores ?? 'none',
    pollenStores: b.pollenStores ?? 'none',
    populationSize: b.populationSize ?? 'none',
    hiveWeight: b.hiveWeight ?? 0,
    healthStatus: b.healthStatus ?? 'good',
    healthAutoCalculated: b.healthAutoCalculated ? 1 : 0,
    colonyDead: b.colonyDead ? 1 : 0,
    notes: b.notes ?? '',
    photoUrls: JSON.stringify(b.photoUrls || []),
  }));

  // Replace concerns if provided
  if (Array.isArray(b.concerns)) {
    // Supersede old concerns
    const oldConcerns = db.prepare('SELECT id FROM concerns WHERE inspectionId = ? AND superseded_by IS NULL').all(entityId) as { id: string }[];
    const ts = now();
    for (const oc of oldConcerns) {
      db.prepare('UPDATE concerns SET superseded_by = ?, superseded_at = ? WHERE id = ?').run(genId('c'), ts, oc.id);
    }
    const insConcern = db.prepare(`INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`);
    for (const c of b.concerns) {
      const concernEntityId = c.id || genId('c');
      insConcern.run(genId('c'), concernEntityId, entityId, c.type, c.count ?? null, c.note ?? null);
    }
  }

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(newRowId) as InspectionRow;
  res.json(mapInspection(row, getConcernsFor(entityId)));
});

app.delete('/api/inspections/:id', (req, res) => {
  // Delete all versions + concerns
  db.prepare('DELETE FROM concerns WHERE inspectionId = ?').run(req.params.id);
  db.prepare('DELETE FROM media_items WHERE inspectionId = ?').run(req.params.id);
  db.prepare('DELETE FROM inspections WHERE entity_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// History & revert
app.get('/api/inspections/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM inspections WHERE entity_id = ? ORDER BY version DESC').all(req.params.id) as InspectionRow[];
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows.map((r) => ({ ...mapInspection(r, getConcernsFor(r.entity_id)), supersededBy: r.superseded_by, supersededAt: r.superseded_at })));
});

app.post('/api/inspections/:id/revert', (req, res) => {
  const entityId = req.params.id;
  const targetVersion = Number(req.query.version);
  if (!targetVersion) return res.status(400).json({ error: 'version query param required' });

  const target = db.prepare('SELECT * FROM inspections WHERE entity_id = ? AND version = ?').get(entityId, targetVersion) as InspectionRow | undefined;
  if (!target) return res.status(404).json({ error: `version ${targetVersion} not found` });

  const newRowId = cowSupersede('inspections', entityId, () => ({
    hiveId: target.hiveId,
    date: target.date,
    queenPresent: target.queenPresent,
    queenCells: target.queenCells,
    queenLayingPattern: target.queenLayingPattern,
    eggsPresent: target.eggsPresent,
    larvaePresent: target.larvaePresent,
    cappedBrood: target.cappedBrood,
    temperament: target.temperament,
    honeyStores: target.honeyStores,
    pollenStores: target.pollenStores,
    populationSize: target.populationSize,
    hiveWeight: target.hiveWeight,
    healthStatus: target.healthStatus,
    healthAutoCalculated: target.healthAutoCalculated,
    colonyDead: target.colonyDead,
    notes: target.notes,
    photoUrls: target.photoUrls,
  }));

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(newRowId) as InspectionRow;
  res.json(mapInspection(row, getConcernsFor(entityId)));
});

// ============================================================================
// /api/sensors
// ============================================================================
app.get('/api/sensors', (_req, res) => {
  const rows = db.prepare('SELECT * FROM sensors WHERE superseded_by IS NULL').all() as any[];
  res.json(rows.map(mapSensor));
});

app.get('/api/sensors/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sensors WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapSensor(row));
});

app.post('/api/sensors', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('s');
  const rowId = genId('s');
  db.prepare(`INSERT INTO sensors (id, entity_id, version, superseded_by, superseded_at, deviceId, name, model, hiveId, boxId, position, latestReading) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rowId, entityId, b.deviceId ?? '', b.name ?? '', b.model ?? '', b.hiveId ?? null, b.boxId ?? null, b.position ?? null, b.latestReading ? JSON.stringify(b.latestReading) : null);
  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(rowId) as any;
  res.status(201).json(mapSensor(row));
});

app.put('/api/sensors/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM sensors WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });

  const newRowId = cowSupersede('sensors', entityId, () => ({
    deviceId: b.deviceId ?? '',
    name: b.name ?? '',
    model: b.model ?? '',
    hiveId: b.hiveId ?? null,
    boxId: b.boxId ?? null,
    position: b.position ?? null,
    latestReading: b.latestReading ? JSON.stringify(b.latestReading) : null,
  }));

  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(newRowId) as any;
  res.json(mapSensor(row));
});

app.delete('/api/sensors/:id', (req, res) => {
  db.prepare('DELETE FROM sensors WHERE entity_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// History & revert
app.get('/api/sensors/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM sensors WHERE entity_id = ? ORDER BY version DESC').all(req.params.id) as any[];
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows.map((r) => ({ ...mapSensor(r), supersededBy: r.superseded_by, supersededAt: r.superseded_at })));
});

app.post('/api/sensors/:id/revert', (req, res) => {
  const entityId = req.params.id;
  const targetVersion = Number(req.query.version);
  if (!targetVersion) return res.status(400).json({ error: 'version query param required' });

  const target = db.prepare('SELECT * FROM sensors WHERE entity_id = ? AND version = ?').get(entityId, targetVersion) as any | undefined;
  if (!target) return res.status(404).json({ error: `version ${targetVersion} not found` });

  const newRowId = cowSupersede('sensors', entityId, () => ({
    deviceId: target.deviceId,
    name: target.name,
    model: target.model,
    hiveId: target.hiveId,
    boxId: target.boxId,
    position: target.position,
    latestReading: target.latestReading,
  }));

  const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(newRowId) as any;
  res.json(mapSensor(row));
});

// ============================================================================
// /api/tasks
// ============================================================================
app.get('/api/tasks', (_req, res) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE superseded_by IS NULL').all() as any[];
  res.json(rows.map(mapTask));
});

app.get('/api/tasks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapTask(row));
});

app.post('/api/tasks', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('task');
  const rowId = genId('task');
  db.prepare(`INSERT INTO tasks (id, entity_id, version, superseded_by, superseded_at, hiveId, apiaryId, title, description, dueDate, completed, priority) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rowId, entityId, b.hiveId ?? null, b.apiaryId ?? null, b.title ?? '', b.description ?? null, b.dueDate ?? null, b.completed ? 1 : 0, b.priority ?? 'medium');
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(rowId) as any;
  res.status(201).json(mapTask(row));
});

app.put('/api/tasks/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM tasks WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });

  const newRowId = cowSupersede('tasks', entityId, () => ({
    hiveId: b.hiveId ?? null,
    apiaryId: b.apiaryId ?? null,
    title: b.title ?? '',
    description: b.description ?? null,
    dueDate: b.dueDate ?? null,
    completed: b.completed ? 1 : 0,
    priority: b.priority ?? 'medium',
  }));

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(newRowId) as any;
  res.json(mapTask(row));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE entity_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// History & revert
app.get('/api/tasks/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE entity_id = ? ORDER BY version DESC').all(req.params.id) as any[];
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows.map((r) => ({ ...mapTask(r), supersededBy: r.superseded_by, supersededAt: r.superseded_at })));
});

app.post('/api/tasks/:id/revert', (req, res) => {
  const entityId = req.params.id;
  const targetVersion = Number(req.query.version);
  if (!targetVersion) return res.status(400).json({ error: 'version query param required' });

  const target = db.prepare('SELECT * FROM tasks WHERE entity_id = ? AND version = ?').get(entityId, targetVersion) as any | undefined;
  if (!target) return res.status(404).json({ error: `version ${targetVersion} not found` });

  const newRowId = cowSupersede('tasks', entityId, () => ({
    hiveId: target.hiveId,
    apiaryId: target.apiaryId,
    title: target.title,
    description: target.description,
    dueDate: target.dueDate,
    completed: target.completed,
    priority: target.priority,
  }));

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(newRowId) as any;
  res.json(mapTask(row));
});

// ============================================================================
// /api/media
// ============================================================================
app.get('/api/media', (req, res) => {
  let rows: any[];
  if (req.query.inspectionId) {
    rows = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? AND superseded_by IS NULL ORDER BY timestamp DESC').all(req.query.inspectionId) as any[];
  } else if (req.query.hiveId) {
    rows = db.prepare('SELECT * FROM media_items WHERE hiveId = ? AND superseded_by IS NULL ORDER BY timestamp DESC').all(req.query.hiveId) as any[];
  } else {
    rows = db.prepare('SELECT * FROM media_items WHERE superseded_by IS NULL ORDER BY timestamp DESC').all() as any[];
  }
  res.json(rows.map(mapMedia));
});

app.get('/api/media/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM media_items WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.id) as any | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(mapMedia(row));
});

app.post('/api/media', (req, res) => {
  const b = req.body || {};
  const entityId = b.id || genId('media');
  const rowId = genId('media');
  db.prepare(`INSERT INTO media_items (id, entity_id, version, superseded_by, superseded_at, inspectionId, hiveId, type, dataUrl, timestamp, label, duration) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rowId, entityId, b.inspectionId ?? null, b.hiveId ?? null, b.type ?? 'photo', b.dataUrl ?? '', b.timestamp ?? new Date().toISOString(), b.label ?? null, b.duration ?? null);
  const row = db.prepare('SELECT * FROM media_items WHERE id = ?').get(rowId) as any;
  res.status(201).json(mapMedia(row));
});

app.put('/api/media/:id', (req, res) => {
  const b = req.body || {};
  const entityId = req.params.id;
  const exists = db.prepare('SELECT 1 FROM media_items WHERE entity_id = ? AND superseded_by IS NULL').get(entityId);
  if (!exists) return res.status(404).json({ error: 'not found' });

  const newRowId = cowSupersede('media_items', entityId, () => ({
    inspectionId: b.inspectionId ?? null,
    hiveId: b.hiveId ?? null,
    type: b.type ?? 'photo',
    dataUrl: b.dataUrl ?? '',
    timestamp: b.timestamp ?? new Date().toISOString(),
    label: b.label ?? null,
    duration: b.duration ?? null,
  }));

  const row = db.prepare('SELECT * FROM media_items WHERE id = ?').get(newRowId) as any;
  res.json(mapMedia(row));
});

app.delete('/api/media/:id', (req, res) => {
  db.prepare('DELETE FROM media_items WHERE entity_id = ?').run(req.params.id);
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
    const hiveRows = db.prepare('SELECT entity_id as id, name FROM hives WHERE superseded_by IS NULL').all() as { id: string; name: string }[];
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
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

    const entityId = genId('insp');
    const rowId = genId('insp');
    db.prepare(
      `INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rowId,
      entityId,
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
        `INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`,
      );
      for (const c of p.concerns) {
        if (!c.type) continue;
        const concernEntityId = genId('c');
        insConcern.run(genId('c'), concernEntityId, entityId, c.type, c.count ?? null, c.note ?? null);
      }
    }

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
    // Update hive health status to match latest inspection (copy-on-write)
    cowSupersede('hives', hiveId, (oldHive) => ({ ...oldHive, healthStatus: health }));
    res.status(201).json(mapInspection(row, getConcernsFor(entityId)));
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
  return image;
}

app.post('/api/vision/analyze', async (req, res) => {
  try {
    const { image, hiveId } = req.body || {};
    if (typeof image !== 'string' || !image.trim()) {
      return res.status(400).json({ error: 'image (string, base64 data URL or raw base64) is required' });
    }

    let hiveName: string | undefined;
    if (hiveId) {
      hiveName = getHiveNameByEntityId(hiveId);
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
    const hiveExists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
    if (!hiveExists) {
      return res.status(404).json({ error: 'hive not found' });
    }

    const hiveName = getHiveNameByEntityId(hiveId);
    const analysis = await analyzeFramePhoto(normalizeImage(image), hiveName);

    // Map analysis → inspection fields
    const layingMap: Record<string, 'excellent' | 'good' | 'fair' | 'poor' | 'none'> = {
      solid: 'excellent',
      spotty: 'poor',
      patchy: 'fair',
      none: 'none',
      unknown: 'none',
    };
    const queenLayingPattern = layingMap[analysis.broodPattern] ?? 'none';

    function ratioToStore(r: number): 'none' | 'low' | 'medium' | 'high' {
      if (r >= 0.5) return 'high';
      if (r >= 0.25) return 'medium';
      if (r >= 0.05) return 'low';
      return 'none';
    }
    const honeyStores = ratioToStore(analysis.honeyRatio);
    const pollenStores = ratioToStore(analysis.pollenRatio);

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
      populationSize: 'none',
      concerns,
      colonyDead: false,
    });

    // Insert inspection
    const entityId = genId('insp');
    const rowId = genId('insp');
    db.prepare(
      'INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      rowId,
      entityId,
      hiveId,
      new Date().toISOString(),
      analysis.queenSpotted ? 1 : 0,
      analysis.queenCellsVisible ? 1 : 0,
      queenLayingPattern,
      analysis.eggsVisible ? 1 : 0,
      analysis.larvaeVisible ? 1 : 0,
      analysis.cappedBroodPresent ? 1 : 0,
      'normal',
      honeyStores,
      pollenStores,
      'none',
      0,
      health,
      1,
      0,
      inspectionNotes,
      JSON.stringify([]),
    );

    // Insert concerns
    if (concerns.length > 0) {
      const insConcern = db.prepare(
        'INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)',
      );
      for (const c of concerns) {
        if (!c.type) continue;
        const concernEntityId = genId('c');
        insConcern.run(genId('c'), concernEntityId, entityId, c.type, c.count ?? null, c.note ?? null);
      }
    }

    // Save the original frame photo to media_items
    try {
      const mediaEntityId = genId('media');
      const mediaRowId = genId('media');
      db.prepare(
        'INSERT INTO media_items (id, entity_id, version, superseded_by, superseded_at, inspectionId, hiveId, type, dataUrl, timestamp, label, duration) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)',
      ).run(mediaRowId, mediaEntityId, entityId, hiveId, 'photo', normalizeImage(image), new Date().toISOString(), 'AI Frame Analysis Photo', null);
      // Also link it via photoUrls on the inspection for quick access
      db.prepare('UPDATE inspections SET photoUrls = ? WHERE id = ?').run(
        JSON.stringify([mediaEntityId]),
        rowId,
      );
    } catch (mediaErr) {
      console.error('[vision/analyze-and-create] media save error:', mediaErr);
    }

    // Update hive health status (copy-on-write)
    cowSupersede('hives', hiveId, (oldHive) => ({ ...oldHive, healthStatus: health }));

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
    const inspection = mapInspection(row, getConcernsFor(entityId));
    const mediaRows = db.prepare('SELECT * FROM media_items WHERE inspectionId = ? AND superseded_by IS NULL ORDER BY timestamp DESC').all(entityId) as any[];
    inspection.media = mediaRows.map(mapMedia);

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
import { analyzeStickyBoard } from './varroa.js';
import { calculateSwarmRisk, calculateSwarmRiskAll } from './swarm.js';

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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const entityId = genId('insp');
    const rowId = genId('insp');
    const inspDate = date ?? new Date().toISOString();
    const concernNote = 'Varroa sticky board count: ' + miteCount + ' mites.';

    db.prepare(
      'INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      rowId,
      entityId,
      hiveId,
      inspDate,
      0,
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
      'fair',
      1,
      0,
      concernNote,
      image ? JSON.stringify([image]) : JSON.stringify([]),
    );

    // Insert a varroa concern with the mite count
    const concernEntityId = genId('c');
    db.prepare(
      'INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)',
    ).run(genId('c'), concernEntityId, entityId, 'varroa', miteCount, concernNote);

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
    res.status(201).json(mapInspection(row, getConcernsFor(entityId)));
  } catch (e) {
    console.error('[vision/varroa/save] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'save failed' });
  }
});

app.get('/api/varroa/history/:hiveId', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC')
      .all(req.params.hiveId) as InspectionRow[];
    const history: any[] = [];
    for (const r of rows) {
      const concerns = getConcernsFor(r.entity_id) as ConcernRowX[];
      const varroa = concerns.find((c) => c.type.toLowerCase() === 'varroa');
      if (varroa) {
        history.push({
          inspectionId: r.entity_id,
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
  entity_id: string;
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.hiveId);
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.hiveId);
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
    const hiveRows = db.prepare('SELECT entity_id as id, name FROM hives WHERE superseded_by IS NULL').all() as { id: string; name: string }[];
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
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

    const entityId = genId('insp');
    const rowId = genId('insp');
    db.prepare(
      `INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rowId,
      entityId,
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
      1,
      0,
      p.notes ?? '',
      JSON.stringify([]),
    );

    // Insert concerns
    if (Array.isArray(p.concerns)) {
      const insConcern = db.prepare(
        `INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)`,
      );
      for (const c of p.concerns) {
        if (!c.type) continue;
        const concernEntityId = genId('c');
        insConcern.run(genId('c'), concernEntityId, entityId, c.type, c.count ?? null, c.note ?? null);
      }
    }

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
    // Update hive health status (copy-on-write)
    cowSupersede('hives', hiveId, (oldHive) => ({ ...oldHive, healthStatus: health }));
    res.status(201).json(mapInspection(row, getConcernsFor(entityId)));
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.hiveId);
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(req.params.hiveId);
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
import { getForageForecast, getForageForecastWithPreview, getAllForageSpecies } from './forage.js';

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

app.get('/api/forage/species/all', (_req, res) => {
  try {
    res.json(getAllForageSpecies());
  } catch (e) {
    res.status(500).json({ error: 'failed to get forage species' });
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
    if (!exists) return res.status(404).json({ error: 'hive not found' });

    const a: AcousticAnalysis = analysis;
    const entityId = genId('insp');
    const rowId = genId('insp');
    const concernNote = 'Acoustic analysis: ' + a.interpretation + ' (confidence: ' + a.confidence + '). ' + a.notes;
    const inspectionNotes = (notes ? notes + '\n\n' : '') + '[Acoustic Analysis]\n' +
      'Interpretation: ' + a.interpretation + '\n' +
      'Confidence: ' + a.confidence + '\n' +
      'Frequency: ' + a.frequency + '\n' +
      'Pattern: ' + a.pattern + '\n' +
      'Recommendations: ' + (a.recommendations || []).join('; ');

    db.prepare(
      'INSERT INTO inspections (id, entity_id, version, superseded_by, superseded_at, hiveId, date, queenPresent, queenCells, queenLayingPattern, eggsPresent, larvaePresent, cappedBrood, temperament, honeyStores, pollenStores, populationSize, hiveWeight, healthStatus, healthAutoCalculated, colonyDead, notes, photoUrls) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      rowId,
      entityId,
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
    const concernEntityId = genId('c');
    db.prepare(
      'INSERT INTO concerns (id, entity_id, version, superseded_by, superseded_at, inspectionId, type, count, note) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?)',
    ).run(genId('c'), concernEntityId, entityId, 'acoustic', null, concernNote);

    const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(rowId) as InspectionRow;
    res.status(201).json(mapInspection(row, getConcernsFor(entityId)));
  } catch (e) {
    console.error('[acoustics/save] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'save failed' });
  }
});

app.get('/api/acoustics/history/:hiveId', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC')
      .all(req.params.hiveId) as InspectionRow[];
    const history: any[] = [];
    for (const r of rows) {
      const concerns = getConcernsFor(r.entity_id) as ConcernRowX[];
      const acoustic = concerns.find((c) => c.type.toLowerCase() === 'acoustic');
      if (acoustic) {
        history.push({
          inspectionId: r.entity_id,
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
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
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
import { getOutlierReport, getAllOutlierReports } from './outlier.js';

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
import { reconstructColony } from './reconstruction.js';

app.post('/api/vision/reconstruct', async (req, res) => {
  try {
    const { images, hiveId } = req.body || {};
    if (!hiveId) return res.status(400).json({ error: 'hiveId is required' });
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'images (string[]) is required' });
    }
    const exists = db.prepare('SELECT 1 FROM hives WHERE entity_id = ? AND superseded_by IS NULL').get(hiveId);
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
// /api/health check
// ============================================================================
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/key', (_req, res) => {
  res.json({ key: API_KEY });
});

// ============================================================================
// Setup status — returns whether DB has any data (for wizard gating)
// ============================================================================
app.get('/api/setup/status', (_req, res) => {
  const apiaries = (db.prepare('SELECT COUNT(*) as c FROM apiaries WHERE superseded_by IS NULL').get() as { c: number }).c;
  const hives = (db.prepare('SELECT COUNT(*) as c FROM hives WHERE superseded_by IS NULL').get() as { c: number }).c;
  const sensors = (db.prepare('SELECT COUNT(*) as c FROM sensors WHERE superseded_by IS NULL').get() as { c: number }).c;
  res.json({
    hasData: apiaries > 0,
    apiaryCount: apiaries,
    hiveCount: hives,
    sensorCount: sensors,
  });
});

// ============================================================================
// Migration status — shows applied and pending migrations
// ============================================================================
app.get('/api/migrations', async (_req, res) => {
  const { listMigrations } = await import('./migrate.js');
  res.json(listMigrations());
});

// ============================================================================
// Serve built frontend (production mode)
// ============================================================================
const distPath = path.resolve(import.meta.dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log(`📦 Serving frontend from ${distPath}`);
} else {
  console.log('⚠️  No dist/ directory — frontend will not be served (run npm run build)');
}

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ============================================================================
// Start
// ============================================================================
const PORT = Number(process.env.PORT || 3001);
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🐝 BeeTree listening on http://${HOST}:${PORT}`);
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
