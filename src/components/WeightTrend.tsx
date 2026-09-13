import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiBase';
import { TrendingUp, TrendingDown, Minus, Scale } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';

interface WeightData {
  hiveId?: string;
  currentWeight: number | null;
  previousWeight: number | null;
  trend: 'gaining' | 'stable' | 'declining' | 'unknown';
  ratePerWeek: number | null;
  history: { date: string; weight: number }[] | null;
  threshold: number | null;
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
  if (!data) return null;

  const history = data.history ?? [];
  const currentWeight = data.currentWeight ?? 0;
  const ratePerWeek = data.ratePerWeek ?? 0;
  const threshold = data.threshold ?? 0;

  if (history.length === 0 && currentWeight === 0) return null;

  const trendIcon = data.trend === 'gaining' ? <TrendingUp size={14} className="text-green-500" />
    : data.trend === 'declining' ? <TrendingDown size={14} className="text-red-500" />
    : <Minus size={14} className="text-stone-400" />;

  const w = 280, h = 40;
  const weights = history.map((p) => p.weight);
  const allValues = weights.length > 0 ? [...weights, threshold] : [threshold, 1];
  const min = Math.min(...allValues) - 1;
  const max = Math.max(...allValues) + 1;
  const range = max - min || 1;
  const path = history.length > 1
    ? history.map((p, i) => {
        const x = (i / (history.length - 1)) * w;
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
        <span className="text-2xl font-bold text-stone-800 dark:text-stone-100">{currentWeight.toFixed(1)}</span>
        <span className="text-sm text-stone-400">lbs</span>
        {ratePerWeek !== 0 && (
          <span className={`text-xs ${data.trend === 'gaining' ? 'text-green-500' : data.trend === 'declining' ? 'text-red-500' : 'text-stone-400'}`}>
            {ratePerWeek > 0 ? '+' : ''}{ratePerWeek.toFixed(1)}/wk
          </span>
        )}
      </div>
      {path && (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
          <line x1="0" y1={h - ((threshold - min) / range) * h} x2={w} y2={h - ((threshold - min) / range) * h} stroke="#ef4444" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
          <path d={path} fill="none" stroke="#d97706" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {data.alert && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-2 flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {data.alert}</p>
      )}
    </div>
  );
}
