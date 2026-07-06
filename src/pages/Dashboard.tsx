import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight, Thermometer, TrendingUp, TrendingDown, Minus, Flower2, MapPin, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { generateAlerts, ALERT_META, type Alert } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { API_BASE, apiFetch } from '../lib/apiBase';

// ─── Forage types (mirror server/forage.ts) ──────────────────────────────────
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

const FLOW_STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  active: { label: 'Active', bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  ending: { label: 'Ending', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  dormant: { label: 'Dormant', bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-500 dark:text-stone-400', dot: 'bg-stone-400' },
};

// Coweta County, GA beekeeping resources
const COWETA_LINKS = [
  { label: 'Coweta Beekeepers Assoc.', url: 'https://www.cowetabeekeepers.org' },
  { label: 'UGA Extension Coweta', url: 'https://extension.uga.edu/county-offices/coweta' },
  { label: 'GA Dept of Ag Apiary Program', url: 'https://agr.georgia.gov/apiary-program.aspx' },
];

export function Dashboard() {
  const { hives, inspections, sensors, tasks } = useStore();
  const { setQuickQuestions } = useChat();
  const alerts = generateAlerts(hives, inspections, sensors, tasks);

  const [forage, setForage] = useState<ForageForecast | null>(null);

  // Fetch current month forage forecast
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(API_BASE + '/api/forage');
        if (!resp.ok) return;
        const data = (await resp.json()) as { current: ForageForecast };
        if (!cancelled) setForage(data.current);
      } catch { /* server not running — skip */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;

  useEffect(() => {
    const qs = [
      "What should I prioritize today?",
      "Which hive needs attention most?",
      "What's my seasonal focus right now?",
    ];
    if (urgentCount > 0) qs.unshift("I have urgent alerts — walk me through them");
    setQuickQuestions(qs);
    return () => setQuickQuestions([]);
  }, [setQuickQuestions, urgentCount]);

  // THE one most important thing
  const topAlert = alerts[0];
  const moreCount = alerts.length - 1;

  // Sensor data for graph
  const sensorsWithReadings = sensors.filter((s) => s.latestReading);
  const avgTemp = sensorsWithReadings.length > 0
    ? sensorsWithReadings.reduce((sum, s) => sum + s.latestReading!.temperature, 0) / sensorsWithReadings.length
    : null;

  // Health distribution
  const healthBuckets = useMemo(() => {
    const buckets: Record<string, number> = { excellent: 0, good: 0, fair: 0, poor: 0, critical: 0 };
    hives.forEach((h) => { buckets[h.healthStatus] = (buckets[h.healthStatus] ?? 0) + 1; });
    return buckets;
  }, [hives]);

  return (
    <div className="animate-fade-in space-y-5">
      {/* ─── COWETA COUNTY FORAGE CARD ─── */}
      {forage && (
        <CowetaForageCard forage={forage} />
      )}

      {/* ─── THE ONE THING ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={20} className="text-honey-600 dark:text-honey-400" />
          <h1 className="text-xl font-bold text-stone-800 dark:text-stone-100">It's Time To...</h1>
        </div>

        {topAlert ? (
          <>
            <BigAlertCard alert={topAlert} />
            {moreCount > 0 && (
              <Link to="/tasks" className="block text-center text-xs text-stone-400 dark:text-stone-500 hover:text-honey-600 mt-2">
                +{moreCount} more {moreCount === 1 ? 'reminder' : 'reminders'} →
              </Link>
            )}
          </>
        ) : (
          <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 text-center">
            <p className="text-base text-emerald-700 dark:text-emerald-300 font-semibold">All caught up 🐝</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Nothing urgent right now. Go enjoy your bees.</p>
          </div>
        )}
      </div>

      {/* ─── SENSOR GRAPH ─── */}
      {sensorsWithReadings.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
              <Thermometer size={16} className="text-orange-500 dark:text-orange-400" /> Hive Temperatures
            </h3>
            <Link to="/sensors" className="text-xs text-stone-400 dark:text-stone-500 hover:text-honey-600">All sensors →</Link>
          </div>

          {/* Current readings with mini bars */}
          <div className="space-y-2.5">
            {sensorsWithReadings.slice(0, 4).map((s) => {
              const r = s.latestReading!;
              const hive = hives.find((h) => h.id === s.hiveId);
              const tempPct = Math.max(0, Math.min(100, ((r.temperature - 80) / (105 - 80)) * 100));
              const isHigh = r.temperature > 99;
              const isLow = r.temperature > 0 && r.temperature < 88;
              const trendIcon = isHigh ? <TrendingUp size={12} className="text-red-500 dark:text-red-400" /> : isLow ? <TrendingDown size={12} className="text-blue-500 dark:text-blue-400" /> : <Minus size={12} className="text-stone-300 dark:text-stone-600" />;
              const barColor = isHigh ? 'bg-red-400' : isLow ? 'bg-blue-400' : 'bg-orange-400';
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-xs text-stone-600 dark:text-stone-300 w-20 truncate shrink-0">{hive?.name ?? s.name}</span>
                  <div className="flex-1 h-6 bg-stone-50 dark:bg-stone-950 rounded-full overflow-hidden relative">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${tempPct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-stone-700 dark:text-stone-200 w-12 text-right tabular-nums">{r.temperature.toFixed(1)}°F</span>
                  {trendIcon}
                </div>
              );
            })}
          </div>

          {/* 48h sparkline */}
          <div className="mt-4 pt-3 border-t border-stone-50">
            <Sparkline sensors={sensorsWithReadings} />
          </div>

          {avgTemp && (
            <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-2 text-center">
              Average: <span className="font-medium text-stone-600 dark:text-stone-300">{avgTemp.toFixed(1)}°F</span> across {sensorsWithReadings.length} sensor{sensorsWithReadings.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* ─── HIVE HEALTH OVERVIEW ─── */}
      {hives.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Hive Health</h3>
            <Link to="/hives" className="text-xs text-stone-400 dark:text-stone-500 hover:text-honey-600">All hives →</Link>
          </div>
          <div className="flex gap-1.5">
            {(['excellent', 'good', 'fair', 'poor', 'critical'] as const).map((status) => {
              const count = healthBuckets[status] ?? 0;
              if (count === 0) return null;
              const meta = HEALTH_META[status];
              const pct = (count / hives.length) * 100;
              return (
                <div
                  key={status}
                  className={`${meta.bg} rounded-lg px-2 py-1.5 text-center`}
                  style={{ flex: pct }}
                  title={`${meta.label}: ${count}`}
                >
                  <div className={`text-sm font-bold ${meta.text}`}>{count}</div>
                  <div className={`text-[9px] ${meta.text} capitalize`}>{meta.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── ASK BUZZ ─── */}
      <div className="pt-1">
        <AskAIButton prompt="What should I focus on right now? Give me the short version." label="Ask Buzz" />
      </div>
    </div>
  );
}

// ─── Coweta County forage card ───
function CowetaForageCard({ forage }: { forage: ForageForecast }) {
  const [expanded, setExpanded] = useState(false);
  const activeFlows = forage.majorFlows.filter((f) => f.status === 'active');
  const endingFlows = forage.majorFlows.filter((f) => f.status === 'ending');
  const upcomingFlows = forage.majorFlows.filter((f) => f.status === 'upcoming');

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 overflow-hidden">
      {/* Header bar */}
      <div className="bg-gradient-to-r from-honey-500 to-honey-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flower2 size={20} className="text-white" />
          <div>
            <div className="text-white font-bold text-sm leading-tight">Coweta County · {forage.month}</div>
            <div className="text-white/80 text-[11px] leading-tight flex items-center gap-1">
              <MapPin size={10} /> Nectar Flow Report
            </div>
          </div>
        </div>
        <Link
          to="/forage"
          className="text-white/90 text-xs font-medium bg-white/20 dark:bg-white/10 px-3 py-1.5 rounded-lg hover:bg-white/30 dark:hover:bg-white/20 transition-colors flex items-center gap-1"
        >
          Details
          <ChevronRight size={14} />
        </Link>
      </div>

      {/* Active flows */}
      <div className="p-4">
        {activeFlows.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">In Bloom Now</p>
            <div className="space-y-1.5">
              {activeFlows.map((f) => (
                <div key={f.plant} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-sm font-medium text-stone-800 dark:text-stone-100">{f.plant}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-medium">Active</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {endingFlows.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">Ending</p>
            <div className="space-y-1.5">
              {endingFlows.map((f) => (
                <div key={f.plant} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{f.plant}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 font-medium">Ending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {upcomingFlows.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">Coming Up</p>
            <div className="space-y-1.5">
              {upcomingFlows.slice(0, 3).map((f) => (
                <div key={f.plant} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-sm text-stone-500 dark:text-stone-400">{f.plant}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium">Soon</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendation */}
        <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          {forage.recommendation}
        </p>

        {/* Expandable details */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-honey-600 dark:text-honey-400 font-medium flex items-center gap-1 hover:text-honey-700"
        >
          {expanded ? 'Hide' : 'Show'} tips & resources
          <ChevronRight size={12} className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'} />
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {/* Management tips */}
            {forage.managementTips.length > 0 && (
              <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
                <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">This Month's Tips</p>
                <ul className="space-y-1">
                  {forage.managementTips.slice(0, 4).map((tip, i) => (
                    <li key={i} className="text-xs text-stone-600 dark:text-stone-300 flex items-start gap-1.5">
                      <span className="text-honey-500 mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Coweta resources */}
            <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">Local Resources</p>
              <div className="space-y-1.5">
                {COWETA_LINKS.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-honey-700 dark:text-honey-300 hover:text-honey-800 font-medium"
                  >
                    <ExternalLink size={12} />
                    {link.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Full per-plant details */}
            <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">All Active & Ending Flows</p>
              <div className="space-y-2">
                {activeFlows.concat(endingFlows).map((f) => (
                  <div key={f.plant} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-stone-700 dark:text-stone-200">{f.plant}</span>
                      <span className={'text-[10px] px-1.5 py-0.5 rounded-full font-medium ' + (FLOW_STATUS_META[f.status]?.bg || '') + ' ' + (FLOW_STATUS_META[f.status]?.text || '')}>
                        {FLOW_STATUS_META[f.status]?.label || f.status}
                      </span>
                    </div>
                    <p className="text-stone-400 dark:text-stone-500 mt-0.5">{f.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── THE big card ───
function BigAlertCard({ alert }: { alert: Alert }) {
  const meta = ALERT_META[alert.severity];
  return (
    <div className={`rounded-2xl border-2 ${meta.border} ${meta.bg} p-5`}>
      <div className="flex items-start gap-3">
        <span className={`w-3.5 h-3.5 rounded-full ${meta.dot} mt-1.5 shrink-0 animate-pulse`} />
        <div className="min-w-0 flex-1">
          <div className={`text-base font-bold ${meta.text}`}>{alert.title}</div>
          <div className="text-sm text-stone-700 dark:text-stone-200 mt-1 leading-relaxed">{alert.message}</div>
        </div>
      </div>
      {alert.actionRoute && (
        <Link
          to={alert.actionRoute}
          className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-honey-700 dark:text-honey-300 bg-white/80 dark:bg-stone-900/80 px-4 py-2 rounded-xl hover:bg-white transition-colors`}
        >
          {alert.actionLabel ?? 'Go'}
          <ChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}

// ─── 48h temperature sparkline ───
function Sparkline({ sensors }: { sensors: ReturnType<typeof useStore>['sensors'] }) {
  // Generate a 48h mock trend per sensor (same pattern as SensorDetail)
  const colors = ['#f97316', '#f59e0b', '#eab308', '#84cc16'];
  const w = 320;
  const h = 60;

  const paths = sensors.slice(0, 4).map((sensor, idx) => {
    const base = 88 + (sensor.deviceId.charCodeAt(0) % 6);
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = new Date(Date.now() - (48 - i) * 3600 * 1000);
      const cycle = Math.sin((t.getHours() / 24) * Math.PI * 2 - Math.PI / 2);
      const temp = base + cycle * 4;
      const x = (i / 48) * w;
      const y = h - ((temp - 80) / (105 - 80)) * h;
      points.push({ x, y });
    }
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    return { path, color: colors[idx % colors.length], name: sensor.name };
  });

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
        {paths.map((p, i) => (
          <path key={i} d={p.path} fill="none" stroke={p.color} strokeWidth="2" opacity="0.7" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
        <span>48h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}