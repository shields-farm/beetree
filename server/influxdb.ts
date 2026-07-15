/**
 * InfluxDB v1 query helper for BeeTree.
 * Queries the HA InfluxDB integration's data stored on the HA Pi.
 *
 * Results are cached in SQLite (telemetry_cache table) to avoid
 * round-tripping to the HA Pi on every request. The background poller
 * refreshes the cache every 5 min; API reads serve from cache.
 *
 * Schema: measurements are named by unit (°F, %, dBm, V),
 * with entity_id as a tag. Example:
 *   SELECT value FROM "°F" WHERE entity_id = 'sensor.broodminder_471287_...'
 *
 * Entity ID pattern from HA:
 *   sensor.broodminder_{deviceId}_broodminder_{deviceId}_{measurement}
 */

import { db } from './db.js';

const INFLUX_URL = 'http://192.0.2.30:8086';
const INFLUX_DB = 'broodminder';
const INFLUX_USER = 'admin';
const INFLUX_PASS = '<REDACTED-INFLUXDB-PASSWORD>';

// Cache TTL: how long before we consider cached data stale.
// The background poller refreshes every 5 min, so 6 min gives slack.
const CACHE_TTL_MS = 6 * 60 * 1000;

export interface TimeSeriesPoint {
  time: string;
  temperature?: number;
  humidity?: number;
  batteryVoltage?: number;
  signal?: number;
}

export interface SensorTimeSeries {
  deviceId: string;
  points: TimeSeriesPoint[];
}

async function influxQuery(query: string): Promise<any[]> {
  const url = `${INFLUX_URL}/query?db=${INFLUX_DB}&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${INFLUX_USER}:${INFLUX_PASS}`).toString('base64'),
    },
  });
  if (!resp.ok) throw new Error(`InfluxDB returned ${resp.status}`);
  const json = await resp.json() as any;
  const series = json?.results?.[0]?.series;
  if (!series || series.length === 0) return [];
  return series[0].values || [];
}

function buildEntityId(deviceId: string, measurement: string): string {
  // HA InfluxDB stores entity_id WITHOUT "sensor." prefix as a field (not tag):
  // broodminder_{deviceId}_broodminder_{deviceId}_{measurement}
  // deviceId in HA is lowercase, no colons
  const cleanId = deviceId.replace(/:/g, '').toLowerCase();
  return `broodminder_${cleanId}_broodminder_${cleanId}_${measurement}`;
}

export async function getSensorTimeSeries(
  entityId: string,
  range: string,
  deviceId?: string,
): Promise<SensorTimeSeries> {
  // If we have a deviceId, build the HA entity_id pattern
  const queries: string[] = [];

  if (deviceId) {
    const tempEntity = buildEntityId(deviceId, 'temperature');
    const humEntity = buildEntityId(deviceId, 'humidity');
    const battEntity = buildEntityId(deviceId, 'battery_voltage');
    const signalEntity = buildEntityId(deviceId, 'signal');

    queries.push(
      `SELECT value FROM "°F" WHERE entity_id = '${tempEntity}' AND time > now() ${range} ORDER BY time ASC`,
      `SELECT value FROM "%" WHERE entity_id = '${humEntity}' AND time > now() ${range} ORDER BY time ASC`,
      `SELECT value FROM "V" WHERE entity_id = '${battEntity}' AND time > now() ${range} ORDER BY time ASC`,
      `SELECT value FROM "dBm" WHERE entity_id = '${signalEntity}' AND time > now() ${range} ORDER BY time ASC`,
    );
  }

  // Run all queries in one batch
  const batchQuery = queries.join(';');
  const url = `${INFLUX_URL}/query?db=${INFLUX_DB}&q=${encodeURIComponent(batchQuery)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${INFLUX_USER}:${INFLUX_PASS}`).toString('base64'),
    },
  });
  if (!resp.ok) throw new Error(`InfluxDB returned ${resp.status}`);
  const json = await resp.json() as any;
  const results = json?.results || [];

  // Merge time series by timestamp
  const pointMap = new Map<string, TimeSeriesPoint>();

  for (const result of results) {
    const series = result?.series;
    if (!series || series.length === 0) continue;
    for (const row of series[0].values || []) {
      const time = row[0];
      const value = row[1];
      if (value === null || value === undefined) continue;
      if (!pointMap.has(time)) {
        pointMap.set(time, { time });
      }
      const pt = pointMap.get(time)!;
      // Determine which measurement based on which query
      const idx = results.indexOf(result);
      if (idx === 0) pt.temperature = Number(value);
      else if (idx === 1) pt.humidity = Number(value);
      else if (idx === 2) pt.batteryVoltage = Number(value);
      else if (idx === 3) pt.signal = Number(value);
    }
  }

  const points = Array.from(pointMap.values()).sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  return { deviceId: deviceId || entityId, points };
}

export async function getAllSensorTimeSeries(range: string): Promise<SensorTimeSeries[]> {
  // Try cache first — if we have data fresher than CACHE_TTL, serve from SQLite.
  const cacheAge = getCacheAge();
  if (cacheAge !== null && cacheAge < CACHE_TTL_MS) {
    const cached = readCacheForRange(range);
    if (cached.length > 0) {
      console.log(`[influxdb] serving ${cached.length} sensors from cache (${Math.round(cacheAge / 1000)}s old)`);
      return cached;
    }
  }

  // Cache miss or stale — fetch from InfluxDB
  try {
    const fresh = await fetchAllFromInflux(range);
    // Upsert into SQLite cache
    upsertCache(fresh);
    console.log(`[influxdb] fetched ${fresh.length} sensors from InfluxDB, cached to SQLite`);
    return fresh;
  } catch (e) {
    // InfluxDB unreachable — fall back to whatever cache we have
    console.warn('[influxdb] InfluxDB fetch failed, falling back to cache:', e);
    const cached = readCacheForRange(range);
    if (cached.length > 0) {
      console.log(`[influxdb] serving ${cached.length} sensors from STALE cache`);
      return cached;
    }
    throw e;
  }
}

// ── Background poller: fetch last 7d from InfluxDB and update cache ──────────

export async function refreshTelemetryCache(): Promise<void> {
  try {
    const fresh = await fetchAllFromInflux('-7d');
    upsertCache(fresh);
    console.log(`[influxdb] background refresh: ${fresh.length} sensors, ${fresh.reduce((n, s) => n + s.points.length, 0)} points cached`);
  } catch (e) {
    console.warn('[influxdb] background refresh failed:', e);
  }
}

// ── Cache helpers ────────────────────────────────────────────────────────────

/** Get age of most recent cached point in milliseconds, or null if empty. */
function getCacheAge(): number | null {
  const row = db.prepare('SELECT MAX(cachedAt) as latest FROM telemetry_cache').get() as { latest: string | null } | undefined;
  if (!row?.latest) return null;
  return Date.now() - new Date(row.latest + 'Z').getTime();
}

/** Read cached points within the given time range, grouped by deviceId. */
function readCacheForRange(range: string): SensorTimeSeries[] {
  // Convert InfluxDB range (-24h, -7d) to a SQL WHERE clause
  const hours = parseRangeToHours(range);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const rows = db.prepare(
    `SELECT deviceId, time, temperature, humidity, batteryVoltage, signal
     FROM telemetry_cache
     WHERE time >= ?
     ORDER BY deviceId, time ASC`,
  ).all(since) as { deviceId: string; time: string; temperature: number | null; humidity: number | null; batteryVoltage: number | null; signal: number | null }[];

  if (rows.length === 0) return [];

  const byDevice = new Map<string, TimeSeriesPoint[]>();
  for (const r of rows) {
    if (!byDevice.has(r.deviceId)) byDevice.set(r.deviceId, []);
    byDevice.get(r.deviceId)!.push({
      time: r.time,
      temperature: r.temperature ?? undefined,
      humidity: r.humidity ?? undefined,
      batteryVoltage: r.batteryVoltage ?? undefined,
      signal: r.signal ?? undefined,
    });
  }

  return Array.from(byDevice.entries()).map(([deviceId, points]) => ({
    deviceId,
    points,
  }));
}

/** Upsert fetched time-series into the SQLite cache. */
function upsertCache(series: SensorTimeSeries[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO telemetry_cache (deviceId, time, temperature, humidity, batteryVoltage, signal, cachedAt)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const upsertAll = db.transaction((all: SensorTimeSeries[]) => {
    for (const s of all) {
      for (const p of s.points) {
        stmt.run(s.deviceId, p.time, p.temperature ?? null, p.humidity ?? null, p.batteryVoltage ?? null, p.signal ?? null);
      }
    }
  });
  upsertAll(series);
}

/** Parse InfluxDB range string (-24h, -7d, -6h) to hours. */
function parseRangeToHours(range: string): number {
  const m = range.match(/-(\d+)([hdw])/);
  if (!m) return 24; // default
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 24 * 7;
  return 24;
}

// ── Raw InfluxDB fetch (no cache) ───────────────────────────────────────────

async function fetchAllFromInflux(range: string): Promise<SensorTimeSeries[]> {
  // Query all 4 measurements for all broodminder sensors.
  // entity_id is a field (not a tag) in HA's InfluxDB schema, so we
  // SELECT value, entity_id and group client-side by entity_id.
  // We extract the deviceId from the entity_id pattern to merge measurements.
  //
  // entity_id pattern: broodminder_{cleanId}_broodminder_{cleanId}_{measurement}

  const queries = [
    `SELECT value, entity_id FROM "°F" WHERE entity_id =~ /broodminder.*temperature/ AND time > now() ${range} ORDER BY time ASC`,
    `SELECT value, entity_id FROM "%" WHERE entity_id =~ /broodminder.*humidity/ AND time > now() ${range} ORDER BY time ASC`,
    `SELECT value, entity_id FROM "V" WHERE entity_id =~ /broodminder.*battery/ AND time > now() ${range} ORDER BY time ASC`,
    `SELECT value, entity_id FROM "dBm" WHERE entity_id =~ /broodminder.*signal/ AND time > now() ${range} ORDER BY time ASC`,
  ];

  const batchQuery = queries.join(';');
  const url = `${INFLUX_URL}/query?db=${INFLUX_DB}&q=${encodeURIComponent(batchQuery)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${INFLUX_USER}:${INFLUX_PASS}`).toString('base64'),
    },
  });
  if (!resp.ok) throw new Error(`InfluxDB returned ${resp.status}`);
  const json = await resp.json() as any;
  const results = json?.results || [];

  // Map: deviceId → Map<time, TimeSeriesPoint>
  const byDevice = new Map<string, Map<string, TimeSeriesPoint>>();

  function getOrCreate(deviceId: string, time: string): TimeSeriesPoint {
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, new Map());
    const timeMap = byDevice.get(deviceId)!;
    if (!timeMap.has(time)) timeMap.set(time, { time });
    return timeMap.get(time)!;
  }

  // Extract deviceId from entity_id: broodminder_{cleanId}_broodminder_{cleanId}_{measurement}
  function extractDeviceId(entityId: string): string | null {
    const m = entityId.match(/^broodminder_([a-f0-9]+)_broodminder_\1_/);
    return m ? m[1] : null;
  }

  for (const result of results) {
    const series = result?.series;
    if (!series || series.length === 0) continue;
    const idx = results.indexOf(result); // 0=temp, 1=hum, 2=batt, 3=signal

    for (const s of series) {
      const cols = s.columns || [];
      const timeIdx = cols.indexOf('time');
      const valueIdx = cols.indexOf('value');
      const entityIdIdx = cols.indexOf('entity_id');
      if (timeIdx < 0 || valueIdx < 0 || entityIdIdx < 0) continue;

      for (const row of s.values || []) {
        const entityId = row[entityIdIdx] || '';
        const deviceId = extractDeviceId(entityId);
        if (!deviceId) continue;
        const time = row[timeIdx];
        const value = Number(row[valueIdx]);
        if (isNaN(value)) continue;

        const pt = getOrCreate(deviceId, time);
        if (idx === 0) pt.temperature = value;
        else if (idx === 1) pt.humidity = value;
        else if (idx === 2) pt.batteryVoltage = value;
        else if (idx === 3) pt.signal = value;
      }
    }
  }

  return Array.from(byDevice.entries()).map(([deviceId, timeMap]) => ({
    deviceId,
    points: Array.from(timeMap.values()).sort((a, b) => a.time.localeCompare(b.time)),
  }));
}