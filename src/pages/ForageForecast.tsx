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

const API_BASE = 'http://localhost:3001';

interface ForageFlow {
  plant: string;
  status: 'upcoming' | 'active' | 'ending' | 'dormant';
  startMonth: string;
  endMonth: string;
  notes: string;
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
  active: { label: 'Active', bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  ending: { label: 'Ending', bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500' },
  dormant: { label: 'Dormant', bg: 'bg-stone-100', text: 'text-stone-500', dot: 'bg-stone-400' },
};

function seasonForMonth(monthName: string): { name: string; icon: typeof Sun; bg: string; text: string } {
  const m = monthName.toLowerCase();
  if (['march', 'april', 'may'].includes(m)) return { name: 'Spring', icon: Leaf, bg: 'bg-green-50', text: 'text-green-700' };
  if (['june', 'july', 'august'].includes(m)) return { name: 'Summer', icon: Sun, bg: 'bg-amber-50', text: 'text-amber-700' };
  if (['september', 'october', 'november'].includes(m)) return { name: 'Fall', icon: CloudRain, bg: 'bg-orange-50', text: 'text-orange-700' };
  return { name: 'Winter', icon: Snowflake, bg: 'bg-blue-50', text: 'text-blue-700' };
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
        const resp = await fetch(API_BASE + '/api/forage');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
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
          <div className="flex items-center justify-center py-8 text-stone-400 text-sm">
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
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
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

      {/* Current month banner */}
      <div className={'rounded-2xl p-5 ' + season.bg}>
        <div className="flex items-center gap-3">
          <SeasonIcon size={28} className={season.text} />
          <div>
            <div className="text-2xl font-bold text-stone-800">{current.month}</div>
            <div className={'text-sm font-medium ' + season.text}>{season.name} season</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-stone-700 leading-relaxed">{current.recommendation}</p>
      </div>

      {/* Active flows */}
      {activeFlows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-2 flex items-center gap-2">
            <Flower2 size={16} className="text-honey-500" /> Active flows
          </h3>
          <div className="space-y-2">
            {activeFlows.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-stone-800">{f.plant}</div>
                      <div className="text-xs text-stone-400 mt-0.5">{f.startMonth} – {f.endMonth}</div>
                    </div>
                    <span className={'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + sm.bg + ' ' + sm.text}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + sm.dot} />
                      {sm.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500 leading-relaxed">{f.notes}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming flows this month */}
      {upcomingCurrent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-2 flex items-center gap-2">
            <ChevronRight size={16} className="text-stone-400" /> Upcoming this month
          </h3>
          <div className="space-y-2">
            {upcomingCurrent.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-stone-700">{f.plant}</div>
                      <div className="text-xs text-stone-400 mt-0.5">{f.startMonth} – {f.endMonth}</div>
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
          <h3 className="text-sm font-semibold text-stone-800 mb-2 flex items-center gap-2">
            <ChevronRight size={16} className="text-stone-400" /> Next month preview — {next.month}
          </h3>
          <div className="space-y-2">
            {nextUpcoming.map((f, i) => {
              const sm = STATUS_META[f.status];
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-stone-700">{f.plant}</div>
                      <div className="text-xs text-stone-400 mt-0.5">{f.startMonth} – {f.endMonth}</div>
                    </div>
                    <span className={'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + sm.bg + ' ' + sm.text}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + sm.dot} />
                      {sm.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500 leading-relaxed">{f.notes}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {current.majorFlows.length === 0 && nextUpcoming.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 text-center py-4">Dormant season — no major flows active or upcoming.</p>
        </Card>
      )}

      {/* Management tips */}
      {current.managementTips.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-2 flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-500" /> Management tips
          </h3>
          <Card>
            <div className="space-y-2">
              {current.managementTips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-honey-400" />
                  <span className="text-sm text-stone-700">{tip}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}