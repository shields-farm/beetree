import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiBase';

interface TimeSeriesPoint { time: string; temperature?: number; }
interface SensorTS { deviceId: string; points: TimeSeriesPoint[]; }

// Okabe-Ito colorblind-safe palette
const COLORS = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00'];

export function DashboardSensorChart() {
  const [data, setData] = useState<SensorTS[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/sensors/timeseries?range=-24h')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: SensorTS[]) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-14 flex items-center justify-center text-[10px] text-stone-400">Loading…</div>;
  }

  if (data.length === 0) {
    return <div className="h-14 flex items-center justify-center text-[10px] text-stone-400">No trend data yet</div>;
  }

  const w = 320;
  const h = 60;
  const allTemps = data.flatMap((s) => s.points.map((p) => p.temperature).filter((t): t is number => t != null));
  if (allTemps.length === 0) return <div className="h-14 flex items-center justify-center text-[10px] text-stone-400">No temp data</div>;
  const min = Math.min(...allTemps);
  const max = Math.max(...allTemps);
  const range = max - min || 1;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
        {data.slice(0, 6).map((sensor, idx) => {
          const pts = sensor.points.filter((p) => p.temperature != null);
          if (pts.length < 2) return null;
          const path = pts
            .map((p, i) => {
              const x = (i / (pts.length - 1)) * w;
              const y = h - ((p.temperature! - min) / range) * h;
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return <path key={idx} d={path} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="1.5" opacity="0.8" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
        <span>24h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
