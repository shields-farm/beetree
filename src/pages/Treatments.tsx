import { useEffect, useState } from 'react';
import {
  Pill,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  Sun,
  Leaf,
  Snowflake,
  CloudRain,
  Thermometer,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';
import { getPestPrefs, filterTreatments } from '../lib/pestPrefs';

interface Treatment {
  type: string;
  timing: string;
  reason: string;
  temperatureRange: string;
  priority: 'high' | 'medium' | 'low';
  notes: string;
}

interface TreatmentRecommendation {
  hiveId: string;
  hiveName: string;
  treatments: Treatment[];
  season: string;
  warnings: string[];
}

const PRIORITY_META: Record<Treatment['priority'], { label: string; bg: string; text: string; border: string }> = {
  high: { label: 'High', bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800', border: 'border-red-200' },
  medium: { label: 'Medium', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800', border: 'border-amber-200' },
  low: { label: 'Low', bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-700 dark:text-stone-200', border: 'border-stone-200 dark:border-stone-800' },
};

const SEASON_ICON: Record<string, typeof Sun> = {
  Spring: Leaf,
  Summer: Sun,
  Fall: CloudRain,
  Winter: Snowflake,
};

const SEASON_META: Record<string, { bg: string; text: string }> = {
  Spring: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
  Summer: { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300' },
  Fall: { bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-700' },
  Winter: { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' },
};

export function Treatments() {
  const [recs, setRecs] = useState<TreatmentRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreatmentRecommendation | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiFetch(API_BASE + '/api/treatment');
        if (!resp.ok) throw new Error(statusToMessage(resp.status));
        const data = (await resp.json()) as TreatmentRecommendation[];
        // Filter treatments by user's pest control preferences
        const prefs = getPestPrefs();
        const filtered = data
          .map((r) => ({ ...r, treatments: filterTreatments(r.treatments, prefs) as Treatment[] }))
          .filter((r) => r.treatments.length > 0 || r.warnings.length > 0);
        if (!cancelled) setRecs(filtered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load treatments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentSeason = recs.length > 0 ? recs[0].season : '';

  if (selected) {
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader
          title={selected.hiveName}
          subtitle="Treatment recommendations"
          action={
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400"
            >
              <ChevronLeft size={18} /> Back
            </button>
          }
        />

        {selected.warnings.length > 0 && (
          <div className="space-y-2">
            {selected.warnings.map((w, i) => (
              <div key={i} className="bg-red-50 dark:bg-red-950 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                <p className="text-sm text-red-800 font-medium">{w}</p>
              </div>
            ))}
          </div>
        )}

        {selected.treatments.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">No active treatments for this hive.</p>
          </Card>
        )}

        <div className="space-y-3">
          {selected.treatments.map((t, i) => {
            const pm = PRIORITY_META[t.priority];
            return (
              <Card key={i}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-800 dark:text-stone-100">{t.type}</div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{t.timing}</div>
                  </div>
                  <span className={'shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ' + pm.bg + ' ' + pm.text}>
                    {pm.label}
                  </span>
                </div>
                <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{t.reason}</p>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <Thermometer size={12} /> {t.temperatureRange}
                </div>
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 leading-relaxed border-t border-stone-50 pt-2">{t.notes}</p>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Treatments" subtitle="Recommended treatments based on inspection concerns" />

      {/* Season indicator */}
      {currentSeason && (
        <div className={'flex items-center gap-2 px-4 py-2.5 rounded-xl ' + (SEASON_META[currentSeason]?.bg ?? 'bg-stone-50 dark:bg-stone-950')}>
          {(() => {
            const Icon = SEASON_ICON[currentSeason] ?? Sun;
            return <Icon size={18} className={SEASON_META[currentSeason]?.text ?? 'text-stone-600 dark:text-stone-300'} />;
          })()}
          <span className={'text-sm font-medium ' + (SEASON_META[currentSeason]?.text ?? 'text-stone-600 dark:text-stone-300')}>
            Current season: {currentSeason}
          </span>
        </div>
      )}

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading treatment recommendations…
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

      {!loading && !error && recs.length === 0 && (
        <Card>
          <div className="text-center py-6">
            <Pill size={32} className="mx-auto text-stone-300 dark:text-stone-600 mb-2" />
            <p className="text-sm text-stone-500 dark:text-stone-400">No hives with active concerns. All colonies look healthy!</p>
          </div>
        </Card>
      )}

      {/* Warnings section */}
      {!loading && recs.some((r) => r.warnings.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Warnings</h3>
          {recs.flatMap((r) => r.warnings.map((w, i) => ({ w, hiveName: r.hiveName, key: r.hiveId + '-' + i }))).map(({ w, hiveName, key }) => (
            <div key={key} className="bg-red-50 dark:bg-red-950 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm text-red-800 font-medium">{w}</p>
                <p className="text-xs text-red-400 mt-0.5">{hiveName}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hive cards */}
      {!loading && !error && recs.length > 0 && (
        <div className="space-y-3">
          {recs.map((r) => {
            const highCount = r.treatments.filter((t) => t.priority === 'high').length;
            return (
              <Card key={r.hiveId} onClick={() => setSelected(r)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{r.hiveName}</div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      {r.treatments.length} treatment{r.treatments.length === 1 ? '' : 's'} recommended
                      {highCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium"> · {highCount} high priority</span>}
                    </div>
                  </div>
                  {r.warnings.length > 0 && (
                    <AlertTriangle size={18} className="shrink-0 text-red-500 dark:text-red-400" />
                  )}
                </div>
                {/* Mini treatment type badges */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.treatments.slice(0, 4).map((t, i) => (
                    <span key={i} className={'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ' + PRIORITY_META[t.priority].bg + ' ' + PRIORITY_META[t.priority].text}>
                      {t.type}
                    </span>
                  ))}
                  {r.treatments.length > 4 && (
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">+{r.treatments.length - 4} more</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}