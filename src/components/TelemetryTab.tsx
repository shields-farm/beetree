import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../lib/apiBase';
import { useStore } from '../store/useStore';
import { Thermometer, Droplets, BatteryFull, Signal, Filter, Loader2 } from 'lucide-react';

interface TimeSeriesPoint {
  time: string;
  temperature?: number;
  humidity?: number;
  batteryVoltage?: number;
  signal?: number;
}
interface SensorTS {
  deviceId: string;
  points: TimeSeriesPoint[];
}

type Metric = 'temperature' | 'humidity' | 'batteryVoltage' | 'signal';

const METRIC_META: Record<Metric, {
  label: string;
  unit: string;
  icon: typeof Thermometer;
  color: string;
  stroke: string;
  min: number;
  max: number;
  fmt: (v: number) => string;
}> = {
  temperature: {
    label: 'Temperature',
    unit: '°F',
    icon: Thermometer,
    color: 'text-orange-500 dark:text-orange-400',
    stroke: '#f97316',
    min: 80,
    max: 105,
    fmt: (v) => v.toFixed(1),
  },
  humidity: {
    label: 'Humidity',
    unit: '%',
    icon: Droplets,
    color: 'text-sky-500 dark:text-sky-400',
    stroke: '#0ea5e9',
    min: 30,
    max: 90,
    fmt: (v) => v.toFixed(0),
  },
  batteryVoltage: {
    label: 'Battery',
    unit: 'V',
    icon: BatteryFull,
    color: 'text-green-500 dark:text-green-400',
    stroke: '#22c55e',
    min: 2.0,
    max: 3.2,
    fmt: (v) => v.toFixed(2),
  },
  signal: {
    label: 'Signal',
    unit: 'dBm',
    icon: Signal,
    color: 'text-purple-500 dark:text-purple-400',
    stroke: '#a855f7',
    min: -110,
    max: -40,
    fmt: (v) => v.toFixed(0),
  },
};

const SENSOR_COLORS = ['#f97316', '#f59e0b', '#eab308', '#84cc16', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];

const RANGES = [
  { value: '-6h', label: '6h' },
  { value: '-24h', label: '24h' },
  { value: '-48h', label: '48h' },
  { value: '-7d', label: '7d' },
];

export function TelemetryTab() {
  const { sensors, hives } = useStore();
  const [data, setData] = useState<SensorTS[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('-24h');
  const [hiveOnly, setHiveOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/sensors/timeseries?range=${range}&_t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: SensorTS[]) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => {
        console.error('[TelemetryTab] fetch failed:', e);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range]);

  // Build deviceId → sensor map for hive filtering and naming
  const deviceMap = useMemo(() => {
    const m = new Map<string, { name: string; hiveId?: string; hiveName?: string }>();
    for (const s of sensors) {
      const cleanId = s.deviceId.replace(/:/g, '').toLowerCase();
      const hive = s.hiveId ? hives.find((h) => h.id === s.hiveId) : undefined;
      m.set(cleanId, {
        name: s.name,
        hiveId: s.hiveId,
        hiveName: hive?.name,
      });
    }
    return m;
  }, [sensors, hives]);

  // Filter to hive-associated sensors only (if toggle on)
  const filteredData = useMemo(() => {
    if (!hiveOnly) return data;
    return data.filter((ts) => {
      const meta = deviceMap.get(ts.deviceId);
      return meta?.hiveId;
    });
  }, [data, hiveOnly, deviceMap]);

  // Enrich with display names
  const enrichedData = useMemo(() => {
    return filteredData.map((ts) => {
      const meta = deviceMap.get(ts.deviceId);
      return {
        ...ts,
        displayName: meta?.hiveName ?? meta?.name ?? ts.deviceId,
        sensorName: meta?.name ?? ts.deviceId,
      };
    });
  }, [filteredData, deviceMap]);

  const hasData = enrichedData.length > 0;

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Range selector */}
        <div className="inline-flex gap-1 bg-stone-100 dark:bg-stone-800 rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                range === r.value
                  ? 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 shadow-sm'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Hive-only toggle */}
        <button
          onClick={() => setHiveOnly(!hiveOnly)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            hiveOnly
              ? 'bg-honey-500 text-white'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
          }`}
        >
          <Filter size={13} />
          Hive sensors only
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-stone-400" size={24} />
        </div>
      ) : !hasData ? (
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-6 text-center">
          <Thermometer size={24} className="text-stone-300 dark:text-stone-600 mx-auto mb-2" />
          <p className="text-sm text-stone-400 dark:text-stone-500">
            {hiveOnly ? 'No hive-associated sensors with telemetry data.' : 'No telemetry data available.'}
          </p>
        </div>
      ) : (
        <>
          {/* 4 metric charts */}
          <MetricChart
            metric="temperature"
            data={enrichedData}
            range={range}
          />
          <MetricChart
            metric="humidity"
            data={enrichedData}
            range={range}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MetricChart
              metric="batteryVoltage"
              data={enrichedData}
              range={range}
              compact
            />
            <MetricChart
              metric="signal"
              data={enrichedData}
              range={range}
              compact
            />
          </div>

          {/* Sensor legend / list */}
          <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3">Sensors</h3>
            <div className="space-y-2">
              {enrichedData.map((ts, i) => {
                const latest = ts.points[ts.points.length - 1];
                const color = SENSOR_COLORS[i % SENSOR_COLORS.length];
                return (
                  <div key={ts.deviceId} className="flex items-center gap-2.5 text-xs">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-stone-700 dark:text-stone-200 font-medium flex-1 truncate">
                      {ts.displayName}
                    </span>
                    {latest?.temperature != null && (
                      <span className="text-stone-500 dark:text-stone-400 tabular-nums">
                        {latest.temperature.toFixed(1)}°F
                      </span>
                    )}
                    {latest?.humidity != null && (
                      <span className="text-stone-400 dark:text-stone-500 tabular-nums">
                        {latest.humidity.toFixed(0)}%
                      </span>
                    )}
                    {latest?.batteryVoltage != null && (
                      <span className="text-stone-400 dark:text-stone-500 tabular-nums">
                        {latest.batteryVoltage.toFixed(2)}V
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Single metric chart card ────────────────────────────────────────────────
function MetricChart({
  metric,
  data,
  range,
  compact = false,
}: {
  metric: Metric;
  data: (SensorTS & { displayName: string; sensorName: string })[];
  range: string;
  compact?: boolean;
}) {
  const meta = METRIC_META[metric];
  const Icon = meta.icon;

  // Extract values for this metric from all sensors
  const sensorsWithMetric = useMemo(() => {
    return data
      .map((ts) => ({
        ...ts,
        pts: ts.points.filter((p) => p[metric] != null),
      }))
      .filter((ts) => ts.pts.length >= 2);
  }, [data, metric]);

  if (sensorsWithMetric.length === 0) return null;

  // Compute y-axis range from actual data
  const allValues = sensorsWithMetric.flatMap((s) => s.pts.map((p) => p[metric]!));
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  // Add padding but clamp to sensible bounds
  const pad = (dataMax - dataMin) * 0.1 || 1;
  const yMin = Math.max(meta.min, dataMin - pad);
  const yMax = Math.min(meta.max, dataMax + pad);
  const yRange = yMax - yMin || 1;

  const w = compact ? 280 : 320;
  const h = compact ? 80 : 120;

  // X-axis: use actual epoch milliseconds for proper linear interpolation
  const allTimes = sensorsWithMetric.flatMap((s) => s.pts.map((p) => new Date(p.time).getTime()));
  const tMin = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const tMax = allTimes.length > 0 ? Math.max(...allTimes) : 0;
  const tRange = (tMax - tMin) || 1;

  function timeToX(time: string): number {
    const t = new Date(time).getTime();
    return ((t - tMin) / tRange) * w;
  }

  function valueToY(val: number): number {
    return h - ((val - yMin) / yRange) * h;
  }

  // Y-axis grid lines (3 lines)
  const gridLines = [0.25, 0.5, 0.75].map((f) => yMin + yRange * f);

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5 ${meta.color}`}>
          <Icon size={16} />
          {meta.label}
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-stone-400 dark:text-stone-500 tabular-nums">
          <span>{meta.fmt(dataMin)} – {meta.fmt(dataMax)} {meta.unit}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: compact ? 80 : 120 }} preserveAspectRatio="none">
          {/* Grid lines */}
          {gridLines.map((val, i) => {
            const y = valueToY(val);
            return (
              <g key={i}>
                <line x1="0" y1={y} x2={w} y2={y} stroke="currentColor" className="text-stone-100 dark:text-stone-800" strokeWidth="1" />
                <text x="2" y={y - 2} fontSize="8" fill="currentColor" className="text-stone-300 dark:text-stone-600">
                  {meta.fmt(val)}
                </text>
              </g>
            );
          })}

          {/* Sensor lines */}
          {sensorsWithMetric.map((sensor, idx) => {
            const color = SENSOR_COLORS[idx % SENSOR_COLORS.length];
            const path = sensor.pts
              .map((p, i) => {
                const x = timeToX(p.time);
                const y = valueToY(p[metric]!);
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <path
                key={sensor.deviceId}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                opacity="0.85"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Time axis labels */}
        <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 mt-1">
          <span>{range.replace('-', '')} ago</span>
          <span>now</span>
        </div>
      </div>

      {/* Per-sensor latest values (compact mode: inline) */}
      {compact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-stone-50 dark:border-stone-800/50">
          {sensorsWithMetric.map((sensor, idx) => {
            const latest = sensor.pts[sensor.pts.length - 1];
            const color = SENSOR_COLORS[idx % SENSOR_COLORS.length];
            return (
              <span key={sensor.deviceId} className="text-[10px] flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-stone-500 dark:text-stone-400 truncate max-w-[80px]">{sensor.displayName}</span>
                <span className="font-medium text-stone-700 dark:text-stone-200 tabular-nums">
                  {latest ? meta.fmt(latest[metric]!) : '—'}{meta.unit}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}