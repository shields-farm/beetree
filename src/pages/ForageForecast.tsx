import { useEffect, useState } from 'react';
import {
  Flower2,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Sun,
  Leaf,
  Snowflake,
  CloudRain,
  Lightbulb,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

interface ForageFlow {
  plant: string;
  status: 'upcoming' | 'active' | 'ending' | 'dormant';
  startMonth: string;
  endMonth: string;
  notes: string;
  significant?: boolean;
  commonness?: number;
  latinName?: string;
  plantType?: string;
}

interface ForageForecast {
  month: string;
  majorFlows: ForageFlow[];
  recommendation: string;
  managementTips: string[];
}

interface ForageResponse {
  current: ForageForecast;
  next: ForageForecast;
}

const STATUS_META: Record<ForageFlow['status'], { label: string; bg: string; text: string; dot: string }> = {
  active: { label: 'Active', bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800', dot: 'bg-green-500' },
  ending: { label: 'Ending', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800', dot: 'bg-blue-500' },
  dormant: { label: 'Dormant', bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-500 dark:text-stone-400', dot: 'bg-stone-400' },
};

function seasonForMonth(monthName: string): { name: string; icon: typeof Sun; bg: string; text: string } {
  const m = monthName.toLowerCase();
  if (['march', 'april', 'may'].includes(m)) return { name: 'Spring', icon: Leaf, bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' };
  if (['june', 'july', 'august'].includes(m)) return { name: 'Summer', icon: Sun, bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300' };
  if (['september', 'october', 'november'].includes(m)) return { name: 'Fall', icon: CloudRain, bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-700' };
  return { name: 'Winter', icon: Snowflake, bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' };
}

export function ForageForecast() {
  const [data, setData] = useState<ForageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiFetch(API_BASE + '/api/forage');
        if (!resp.ok) throw new Error(statusToMessage(resp.status));
        const json = (await resp.json()) as ForageResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load forage forecast');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader title="Forage Forecast" subtitle="Nectar flow calendar for Georgia" />
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading forage forecast…
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader title="Forage Forecast" subtitle="Nectar flow calendar for Georgia" />
        <Card>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { current, next } = data;
  const season = seasonForMonth(current.month);
  const SeasonIcon = season.icon;
  const activeFlows = current.majorFlows.filter((f) => f.status === 'active' || f.status === 'ending');
  const upcomingCurrent = current.majorFlows.filter((f) => f.status === 'upcoming');
  const nextUpcoming = next.majorFlows.filter((f) => f.status === 'active' || f.status === 'ending' || f.status === 'upcoming');

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Forage Forecast" subtitle="Nectar flow calendar for Georgia" />

      {/* Full species calendar with bloom timeline — now at the top */}
      <ForageSpeciesCalendar />

      {/* Current month banner */}
      <div className={'rounded-2xl p-5 ' + season.bg}>
        <div className="flex items-center gap-3">
          <SeasonIcon size={28} className={season.text} />
          <div>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{current.month}</div>
            <div className={'text-sm font-medium ' + season.text}>{season.name} season</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-stone-700 dark:text-stone-200 leading-relaxed">{current.recommendation}</p>
      </div>

      {/* Active flows */}
      {activeFlows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
            <Flower2 size={16} className="text-honey-500" /> Active flows
          </h3>
          <div className="space-y-2">
            {activeFlows.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-stone-800 dark:text-stone-100">{f.plant}</div>
                      <div className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{f.startMonth} – {f.endMonth}</div>
                    </div>
                    <span className={'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + sm.bg + ' ' + sm.text}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + sm.dot} />
                      {sm.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">{f.notes}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming flows this month */}
      {upcomingCurrent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
            <ChevronRight size={16} className="text-stone-400 dark:text-stone-500" /> Upcoming this month
          </h3>
          <div className="space-y-2">
            {upcomingCurrent.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-stone-700 dark:text-stone-200">{f.plant}</div>
                      <div className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{f.startMonth} – {f.endMonth}</div>
                    </div>
                    <span className={'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + sm.bg + ' ' + sm.text}>
                      {sm.label}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Next month preview */}
      {nextUpcoming.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
            <ChevronRight size={16} className="text-stone-400 dark:text-stone-500" /> Next month preview — {next.month}
          </h3>
          <div className="space-y-2">
            {nextUpcoming.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-stone-700 dark:text-stone-200">{f.plant}</div>
                      <div className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{f.startMonth} – {f.endMonth}</div>
                    </div>
                    <span className={'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + sm.bg + ' ' + sm.text}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + sm.dot} />
                      {sm.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">{f.notes}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {current.majorFlows.length === 0 && nextUpcoming.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">Dormant season — no major flows active or upcoming.</p>
        </Card>
      )}

      {/* Management tips */}
      {current.managementTips.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-500" /> Management tips
          </h3>
          <Card>
            <div className="space-y-2">
              {current.managementTips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-honey-400" />
                  <span className="text-sm text-stone-700 dark:text-stone-200">{tip}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}

// ─── Forage Species Calendar with bloom timeline ──────────────────────────────
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthToIndex(monthName: string): number {
  return MONTH_LABELS.findIndex(m => monthName.startsWith(m));
}

function ForageSpeciesCalendar() {
  const [species, setSpecies] = useState<ForageFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(API_BASE + '/api/forage/species/all');
        if (!resp.ok) return;
        const data = (await resp.json()) as ForageFlow[];
        if (!cancelled) setSpecies(data);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || species.length === 0) return null;

  const currentMonth = new Date().getMonth();
  const significant = species.filter(s => s.significant);
  const others = species.filter(s => !s.significant)
    .sort((a, b) => (b.commonness || 0) - (a.commonness || 0)); // most common first

  // Display rule: show significant sources.
  // If no significant sources, show top 3 most common insignificant ones instead.
  // "Show all" toggle reveals everything.
  let display: ForageFlow[];
  if (showAll) {
    display = species;
  } else if (significant.length > 0) {
    display = significant;
  } else {
    display = others.slice(0, 3);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
        <Flower2 size={16} className="text-honey-500" /> Forage species calendar
        <span className="text-xs font-normal text-stone-400 dark:text-stone-500">
          ({species.length} species, NASA HoneyBeeNet GA data)
        </span>
      </h3>

      {/* Month header bar */}
      <Card className="overflow-x-auto">
        <div className="min-w-[500px]">
          {/* Month labels */}
          <div className="flex items-center border-b border-stone-100 dark:border-stone-800 pb-1 mb-1">
            <div className="w-32 sm:w-40 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">Plant</div>
            <div className="flex-1 flex">
              {MONTHS.map((m, i) => (
                <div
                  key={i}
                  className={'flex-1 text-center text-[10px] font-medium ' +
                    (i === currentMonth
                      ? 'text-honey-600 dark:text-honey-400 font-bold'
                      : 'text-stone-400 dark:text-stone-500')}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>

          {/* Species rows */}
          {display.map((s, i) => {
            const start = monthToIndex(s.startMonth);
            const end = monthToIndex(s.endMonth);
            if (start < 0 || end < 0) return null;
            const isActive = s.status === 'active' || s.status === 'ending';
            return (
              <div key={i} className="flex items-center py-1.5 border-b border-stone-50 dark:border-stone-900 last:border-0 group hover:bg-stone-50 dark:hover:bg-stone-900/50 rounded-lg px-1">
                <div className="w-32 sm:w-40 shrink-0">
                  <div className="flex items-center gap-1.5">
                    {s.significant && <span className="text-amber-500 text-xs" title="Significant nectar source">★</span>}
                    <span className={'text-xs font-medium truncate ' + (s.significant ? 'text-stone-800 dark:text-stone-100' : 'text-stone-600 dark:text-stone-300')}>
                      {s.plant}
                    </span>
                  </div>
                  {s.latinName && (
                    <div className="text-[10px] text-stone-400 dark:text-stone-500 italic truncate">{s.latinName}</div>
                  )}
                </div>
                <div className="flex-1 flex relative h-5">
                  {MONTHS.map((_, m) => {
                    const inBloom = m >= start && m <= end;
                    const isCurrent = m === currentMonth;
                    return (
                      <div key={m} className="flex-1 relative">
                        {inBloom && (
                          <div
                            className={
                              'absolute inset-y-0 left-0.5 right-0.5 rounded ' +
                              (isActive && isCurrent
                                ? 'bg-honey-400 dark:bg-honey-500'
                                : s.significant
                                  ? 'bg-honey-200 dark:bg-honey-800'
                                  : 'bg-stone-200 dark:bg-stone-700')
                            }
                          />
                        )}
                        {isCurrent && (
                          <div className="absolute inset-y-[-2px] left-1/2 -translate-x-1/2 w-0.5 bg-honey-500" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Toggle button */}
        {others.length > 0 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-3 text-xs text-honey-600 dark:text-honey-400 font-medium hover:underline"
          >
            {showAll
              ? 'Show significant sources only'
              : significant.length > 0
                ? `Show all ${species.length} species (${others.length} insignificant hidden)`
                : `Show all ${species.length} species`}
          </button>
        )}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-stone-400 dark:text-stone-500">
          <span className="flex items-center gap-1"><span className="text-amber-500">★</span> Significant nectar source</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-honey-400" /> Active now</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-honey-200 dark:bg-honey-800" /> Significant bloom</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-stone-200 dark:bg-stone-700" /> Other bloom</span>
        </div>

        {/* Source attribution */}
        <div className="mt-2 text-[10px] text-stone-400 dark:text-stone-500">
          Data: NASA HoneyBeeNet Ayers &amp; Harman forage map (GA regions 11 &amp; 12) + Beepods + ApiaryBook
        </div>
      </Card>
    </div>
  );
}