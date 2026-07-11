import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiBase';
import { TrendingUp, TrendingDown, Minus, Scale } from 'lucide-react';

interface WeightData {
  hiveId?: string;
  currentWeight: number;
  previousWeight: number | null;
  trend: 'gaining' | 'stable' | 'declining' | 'unknown';
  ratePerWeek: number;
  history: { date: string; weight: number }[];
  threshold: number;
  alert: string | null;
}

export function WeightTrend({ hiveId }: { hiveId: string }) {
  const [data, setData] = useState<WeightData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/weight/${hiveId}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: WeightData) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hiveId]);

  if (loading) return null;
  if (!data || (data.history.length === 0 && data.currentWeight === 0)) return null;

  const trendIcon = data.trend === 'gaining' ? <TrendingUp size={14} className="text-green-500" />
    : data.trend === 'declining' ? <TrendingDown size={14} className="text-red-500" />
    : <Minus size={14} className="text-stone-400" />;

  // Mini sparkline
  const w = 280, h = 40;
  const weights = data.history.map((p) => p.weight);
  const min = Math.min(...weights, data.threshold) - 1;
  const max = Math.max(...weights, data.threshold) + 1;
  const range = max - min || 1;
  const path = data.history.length > 1
    ? data.history.map((p, i) => {
        const x = (i / (data.history.length - 1)) * w;
        const y = h - ((p.weight - min) / range) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ')
    : '';

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
          <Scale size={16} className="text-honey-600 dark:text-honey-400" /> Weight Tracking
        </h3>
        {trendIcon}
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold text-stone-800 dark:text-stone-100">{data.currentWeight.toFixed(1)}</span>
        <span className="text-sm text-stone-400">lbs</span>
        {data.ratePerWeek !== 0 && (
          <span className={`text-xs ${data.trend === 'gaining' ? 'text-green-500' : data.trend === 'declining' ? 'text-red-500' : 'text-stone-400'}`}>
            {data.ratePerWeek > 0 ? '+' : ''}{data.ratePerWeek.toFixed(1)}/wk
          </span>
        )}
      </div>
      {path && (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
          {/* Threshold line */}
          <line x1="0" y1={h - ((data.threshold - min) / range) * h} x2={w} y2={h - ((data.threshold - min) / range) * h} stroke="#ef4444" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
          <path d={path} fill="none" stroke="#d97706" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {data.alert && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-2">⚠️ {data.alert}</p>
      )}
    </div>
  );
}
