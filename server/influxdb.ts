/**
 * InfluxDB v1 query helper for BeeTree.
 * Queries the HA InfluxDB integration's data stored on the HA Pi.
 *
 * Schema: measurements are named by unit (°F, %, dBm, V),
 * with entity_id as a tag. Example:
 *   SELECT value FROM "°F" WHERE entity_id = 'sensor.broodminder_471287_...'
 *
 * Entity ID pattern from HA:
 *   sensor.broodminder_{deviceId}_broodminder_{deviceId}_{measurement}
 */

const INFLUX_URL = 'http://192.0.2.10:8086';
const INFLUX_DB = 'broodminder';
const INFLUX_USER = 'admin';
const INFLUX_PASS = '<REDACTED-INFLUXDB-PASSWORD>';

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
  // Get all broodminder temperature measurements
  // entity_id is a field, not a tag, so we can't GROUP BY entity_id.
  // Instead, select all broodminder data and group client-side.
  const query = `SELECT value, entity_id FROM "°F" WHERE entity_id =~ /broodminder/ AND time > now() ${range} ORDER BY time DESC LIMIT 100`;
  const url = `${INFLUX_URL}/query?db=${INFLUX_DB}&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${INFLUX_USER}:${INFLUX_PASS}`).toString('base64'),
    },
  });
  if (!resp.ok) throw new Error(`InfluxDB returned ${resp.status}`);
  const json = await resp.json() as any;
  const series = json?.results?.[0]?.series || [];

  // Group by entity_id field
  const byEntity = new Map<string, TimeSeriesPoint[]>();
  for (const s of series) {
    const cols = s.columns || [];
    const timeIdx = cols.indexOf('time');
    const valueIdx = cols.indexOf('value');
    const entityIdIdx = cols.indexOf('entity_id');
    for (const row of s.values || []) {
      const entityId = row[entityIdIdx] || 'unknown';
      if (!byEntity.has(entityId)) byEntity.set(entityId, []);
      byEntity.get(entityId)!.push({
        time: row[timeIdx],
        temperature: Number(row[valueIdx]),
      });
    }
  }

  return Array.from(byEntity.entries()).map(([entityId, points]) => ({
    deviceId: entityId,
    points: points.sort((a, b) => a.time.localeCompare(b.time)),
  }));
}