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

const API_BASE = 'http://localhost:3001';

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
  high: { label: 'High', bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' },
  medium: { label: 'Medium', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  low: { label: 'Low', bg: 'bg-stone-100', text: 'text-stone-700', border: 'border-stone-200' },
};

const SEASON_ICON: Record<string, typeof Sun> = {
  Spring: Leaf,
  Summer: Sun,
  Fall: CloudRain,
  Winter: Snowflake,
};

const SEASON_META: Record<string, { bg: string; text: string }> = {
  Spring: { bg: 'bg-green-50', text: 'text-green-700' },
  Summer: { bg: 'bg-amber-50', text: 'text-amber-700' },
  Fall: { bg: 'bg-orange-50', text: 'text-orange-700' },
  Winter: { bg: 'bg-blue-50', text: 'text-blue-700' },
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
        const resp = await fetch(API_BASE + '/api/treatment');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = (await resp.json()) as TreatmentRecommendation[];
        if (!cancelled) setRecs(data);
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
              className="flex items-center gap-1 text-sm text-stone-500"
            >
              <ChevronLeft size={18} /> Back
            </button>
          }
        />

        {selected.warnings.length > 0 && (
          <div className="space-y-2">
            {selected.warnings.map((w, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600" />
                <p className="text-sm text-red-800 font-medium">{w}</p>
              </div>
            ))}
          </div>
        )}

        {selected.treatments.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500 text-center py-4">No active treatments for this hive.</p>
          </Card>
        )}

        <div className="space-y-3">
          {selected.treatments.map((t, i) => {
            const pm = PRIORITY_META[t.priority];
            return (
              <Card key={i}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-800">{t.type}</div>
                    <div className="text-xs text-stone-500 mt-0.5">{t.timing}</div>
                  </div>
                  <span className={'shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ' + pm.bg + ' ' + pm.text}>
                    {pm.label}
                  </span>
                </div>
                <p className="mt-2 text-sm text-stone-600">{t.reason}</p>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
                  <Thermometer size={12} /> {t.temperatureRange}
                </div>
                <p className="mt-2 text-xs text-stone-400 leading-relaxed border-t border-stone-50 pt-2">{t.notes}</p>
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
        <div className={'flex items-center gap-2 px-4 py-2.5 rounded-xl ' + (SEASON_META[currentSeason]?.bg ?? 'bg-stone-50')}>
          {(() => {
            const Icon = SEASON_ICON[currentSeason] ?? Sun;
            return <Icon size={18} className={SEASON_META[currentSeason]?.text ?? 'text-stone-600'} />;
          })()}
          <span className={'text-sm font-medium ' + (SEASON_META[currentSeason]?.text ?? 'text-stone-600')}>
            Current season: {currentSeason}
          </span>
        </div>
      )}

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading treatment recommendations…
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !error && recs.length === 0 && (
        <Card>
          <div className="text-center py-6">
            <Pill size={32} className="mx-auto text-stone-300 mb-2" />
            <p className="text-sm text-stone-500">No hives with active concerns. All colonies look healthy!</p>
          </div>
        </Card>
      )}

      {/* Warnings section */}
      {!loading && recs.some((r) => r.warnings.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-800">Warnings</h3>
          {recs.flatMap((r) => r.warnings.map((w, i) => ({ w, hiveName: r.hiveName, key: r.hiveId + '-' + i }))).map(({ w, hiveName, key }) => (
            <div key={key} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600" />
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
                    <div className="font-semibold text-stone-800 truncate">{r.hiveName}</div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {r.treatments.length} treatment{r.treatments.length === 1 ? '' : 's'} recommended
                      {highCount > 0 && <span className="text-red-600 font-medium"> · {highCount} high priority</span>}
                    </div>
                  </div>
                  {r.warnings.length > 0 && (
                    <AlertTriangle size={18} className="shrink-0 text-red-500" />
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
                    <span className="text-[10px] text-stone-400">+{r.treatments.length - 4} more</span>
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