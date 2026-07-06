import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight, Thermometer, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { generateAlerts, ALERT_META, type Alert } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';

export function Dashboard() {
  const { hives, inspections, sensors, tasks } = useStore();
  const { setQuickQuestions } = useChat();
  const alerts = generateAlerts(hives, inspections, sensors, tasks);

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
      {/* ─── THE ONE THING ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={20} className="text-honey-600" />
          <h1 className="text-xl font-bold text-stone-800">It's Time To...</h1>
        </div>

        {topAlert ? (
          <>
            <BigAlertCard alert={topAlert} />
            {moreCount > 0 && (
              <Link to="/tasks" className="block text-center text-xs text-stone-400 hover:text-honey-600 mt-2">
                +{moreCount} more {moreCount === 1 ? 'reminder' : 'reminders'} →
              </Link>
            )}
          </>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <p className="text-base text-emerald-700 font-semibold">All caught up 🐝</p>
            <p className="text-xs text-emerald-600 mt-1">Nothing urgent right now. Go enjoy your bees.</p>
          </div>
        )}
      </div>

      {/* ─── SENSOR GRAPH ─── */}
      {sensorsWithReadings.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
              <Thermometer size={16} className="text-orange-500" /> Hive Temperatures
            </h3>
            <Link to="/sensors" className="text-xs text-stone-400 hover:text-honey-600">All sensors →</Link>
          </div>

          {/* Current readings with mini bars */}
          <div className="space-y-2.5">
            {sensorsWithReadings.slice(0, 4).map((s) => {
              const r = s.latestReading!;
              const hive = hives.find((h) => h.id === s.hiveId);
              const tempPct = Math.max(0, Math.min(100, ((r.temperature - 80) / (105 - 80)) * 100));
              const isHigh = r.temperature > 99;
              const isLow = r.temperature > 0 && r.temperature < 88;
              const trendIcon = isHigh ? <TrendingUp size={12} className="text-red-500" /> : isLow ? <TrendingDown size={12} className="text-blue-500" /> : <Minus size={12} className="text-stone-300" />;
              const barColor = isHigh ? 'bg-red-400' : isLow ? 'bg-blue-400' : 'bg-orange-400';
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-xs text-stone-600 w-20 truncate shrink-0">{hive?.name ?? s.name}</span>
                  <div className="flex-1 h-6 bg-stone-50 rounded-full overflow-hidden relative">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${tempPct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-stone-700 w-12 text-right tabular-nums">{r.temperature.toFixed(1)}°F</span>
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
            <p className="text-[11px] text-stone-400 mt-2 text-center">
              Average: <span className="font-medium text-stone-600">{avgTemp.toFixed(1)}°F</span> across {sensorsWithReadings.length} sensor{sensorsWithReadings.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* ─── HIVE HEALTH OVERVIEW ─── */}
      {hives.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700">Hive Health</h3>
            <Link to="/hives" className="text-xs text-stone-400 hover:text-honey-600">All hives →</Link>
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

// ─── THE big card ───
function BigAlertCard({ alert }: { alert: Alert }) {
  const meta = ALERT_META[alert.severity];
  return (
    <div className={`rounded-2xl border-2 ${meta.border} ${meta.bg} p-5`}>
      <div className="flex items-start gap-3">
        <span className={`w-3.5 h-3.5 rounded-full ${meta.dot} mt-1.5 shrink-0 animate-pulse`} />
        <div className="min-w-0 flex-1">
          <div className={`text-base font-bold ${meta.text}`}>{alert.title}</div>
          <div className="text-sm text-stone-700 mt-1 leading-relaxed">{alert.message}</div>
        </div>
      </div>
      {alert.actionRoute && (
        <Link
          to={alert.actionRoute}
          className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-honey-700 bg-white/80 px-4 py-2 rounded-xl hover:bg-white transition-colors`}
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
      <div className="flex justify-between text-[10px] text-stone-400 mt-0.5">
        <span>48h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}