import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiBase';

interface TimeSeriesPoint {
  time: string;
  temperature?: number;
  humidity?: number;
  batteryVoltage?: number;
  signal?: number;
}

interface TimeSeriesData {
  deviceId: string;
  points: TimeSeriesPoint[];
}

/**
 * Lightweight SVG trend chart — no external charting dependency.
 * Fetches real data from the BeeTree /api/sensors/:id/timeseries endpoint.
 */
export function SensorTrendChart({ sensorId }: { sensorId: string }) {
  const [data, setData] = useState<TimeSeriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('7d');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/sensors/${sensorId}/timeseries?range=-${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TimeSeriesData) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [sensorId, range]);

  const points = data?.points ?? [];
  const temps = points.map((p) => p.temperature).filter((t): t is number => t != null);
  const hums = points.map((p) => p.humidity).filter((h): h is number => h != null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-stone-400">
        <span className="w-4 h-4 rounded-full border-2 border-honey-400 border-t-transparent animate-spin mr-2" />
        Loading trend data…
      </div>
    );
  }

  if (error || temps.length === 0) {
    return (
      <div className="text-center text-sm text-stone-400 py-6">
        {error ? `Failed to load: ${error}` : 'No historical data available yet.'}
      </div>
    );
  }

  return (
    <div>
      {/* Range selector */}
      <div className="flex gap-1.5 mb-3">
        {['24h', '7d', '30d'].map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
              range === r
                ? 'bg-honey-500 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200'
            }`}
          >
            {r === '24h' ? '24h' : r === '7d' ? '7 days' : '30 days'}
          </button>
        ))}
      </div>

      {/* Temperature chart */}
      <Sparkline
        points={temps}
        label="Temperature"
        unit="°F"
        color="#f59e0b"
        fill="rgba(245,158,11,0.1)"
      />

      {/* Humidity chart */}
      {hums.length > 0 && (
        <div className="mt-3">
          <Sparkline
            points={hums}
            label="Humidity"
            unit="%"
            color="#0ea5e9"
            fill="rgba(14,165,233,0.1)"
          />
        </div>
      )}

      <p className="text-[10px] text-stone-400 mt-2 text-center">
        {temps.length} data points · {points[0]?.time.slice(0, 10)} → {points[points.length - 1]?.time.slice(0, 10)}
      </p>
    </div>
  );
}

function Sparkline({
  points,
  label,
  unit,
  color,
  fill,
}: {
  points: number[];
  label: string;
  unit: string;
  color: string;
  fill: string;
}) {
  const w = 320;
  const h = 70;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${path} L${w},${h} L0,${h} Z`;

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="font-medium text-stone-500 dark:text-stone-400">{label}</span>
        <span className="text-stone-400">
          <span style={{ color }}>{min.toFixed(1)}</span> – <span style={{ color }}>{max.toFixed(1)}</span> {unit}
        </span>
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
          <path d={areaPath} fill={fill} />
          <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
}