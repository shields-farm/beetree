import { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

import { API_BASE, apiFetch } from '../lib/apiBase';

interface HealthHistoryEntry {
  date: string;
  healthStatus: string;
  inspectionId: string;
}

interface HealthTrend {
  hiveId: string;
  hiveName: string;
  history: HealthHistoryEntry[];
  trend: 'improving' | 'stable' | 'declining' | 'insufficient-data';
  commentary: string;
}

const HEALTH_META: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  excellent: { label: 'Excellent', dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
  good: { label: 'Good', dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' },
  fair: { label: 'Fair', dot: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  poor: { label: 'Poor', dot: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-700' },
  critical: { label: 'Critical', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
};

function metaFor(status: string) {
  return HEALTH_META[status?.toLowerCase()] ?? HEALTH_META.fair;
}

const TREND_META: Record<HealthTrend['trend'], { label: string; icon: typeof TrendingUp; bg: string; text: string }> = {
  improving: { label: 'Improving', icon: TrendingUp, bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800' },
  stable: { label: 'Stable', icon: Minus, bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-700 dark:text-stone-200' },
  declining: { label: 'Declining', icon: TrendingDown, bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800' },
  'insufficient-data': { label: 'Insufficient data', icon: Minus, bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-500 dark:text-stone-400' },
};

export function HealthTrends() {
  const [trends, setTrends] = useState<HealthTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HealthTrend | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiFetch(API_BASE + '/api/trending');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = (await resp.json()) as HealthTrend[];
        if (!cancelled) setTrends(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load trends');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (selected) {
    const TrendIcon = TREND_META[selected.trend].icon;
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader
          title={selected.hiveName}
          subtitle="Health trend detail"
          action={
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400"
            >
              <ChevronLeft size={18} /> Back
            </button>
          }
        />

        <Card>
          <div className="flex items-center justify-between">
            <div className="text-sm text-stone-500 dark:text-stone-400">Trend direction</div>
            <div className={'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ' + TREND_META[selected.trend].bg + ' ' + TREND_META[selected.trend].text}>
              <TrendIcon size={14} />
              {TREND_META[selected.trend].label}
            </div>
          </div>
          <p className="mt-3 text-sm text-stone-700 dark:text-stone-200 leading-relaxed">{selected.commentary}</p>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Full history</h3>
          {selected.history.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">No inspections recorded.</p>
          ) : (
            <div className="space-y-2">
              {[...selected.history].reverse().map((h, i) => {
                const m = metaFor(h.healthStatus);
                return (
                  <div key={h.inspectionId} className="flex items-center gap-3 py-2 border-b border-stone-50 last:border-0">
                    <div className={'shrink-0 w-3 h-3 rounded-full ' + m.dot} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{m.label}</div>
                      <div className="text-xs text-stone-400 dark:text-stone-500">{format(new Date(h.date), 'MMM d, yyyy')}</div>
                    </div>
                    <div className="text-xs text-stone-300 dark:text-stone-600">#{selected.history.length - i}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Health Trends" subtitle="AI health trending for all hives" />

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading health trends…
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !error && trends.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-6">No hives found. Add hives to see health trends.</p>
        </Card>
      )}

      {!loading && trends.length > 0 && (
        <div className="space-y-3">
          {trends.map((t) => {
            const TrendIcon = TREND_META[t.trend].icon;
            // Show up to last 8 as sparkline dots
            const recent = t.history.slice(-8);
            return (
              <Card key={t.hiveId} onClick={() => setSelected(t)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{t.hiveName}</div>
                    <div className={'inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + TREND_META[t.trend].bg + ' ' + TREND_META[t.trend].text}>
                      <TrendIcon size={11} /> {TREND_META[t.trend].label}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-stone-300 dark:text-stone-600 shrink-0 mt-1" />
                </div>

                {/* Sparkline dots */}
                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  {recent.length === 0 && (
                    <span className="text-xs text-stone-400 dark:text-stone-500">No inspections yet</span>
                  )}
                  {recent.map((h, i) => {
                    const m = metaFor(h.healthStatus);
                    return (
                      <div
                        key={i}
                        className={'w-3 h-3 rounded-full ' + m.dot}
                        title={m.label + ' — ' + format(new Date(h.date), 'MMM d, yyyy')}
                      />
                    );
                  })}
                  {recent.length > 0 && (
                    <span className="text-xs text-stone-400 dark:text-stone-500 ml-1">
                      {metaFor(recent[recent.length - 1].healthStatus).label}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-2">{t.commentary}</p>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && trends.length > 0 && (
        <p className="text-xs text-stone-400 dark:text-stone-500 text-center px-4">
          Green=excellent · Blue=good · Yellow=fair · Orange=poor · Red=critical. Tap a hive for full history.
        </p>
      )}
    </div>
  );
}