import { Link } from 'react-router-dom';
import { MapPin, Boxes, Thermometer, ClipboardList, CheckSquare, TrendingUp, AlertCircle } from 'lucide-react';
import { formatDistanceToNow, isToday, isPast } from 'date-fns';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';

export function Dashboard() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();

  const recentInspections = [...inspections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const dueTasks = tasks.filter((t) => !t.completed && (!t.dueDate || isPast(new Date(t.dueDate))));
  const hivesWithSensors = hives.filter((h) => h.sensorIds && h.sensorIds.length > 0);
  const healthCounts = hives.reduce<Record<string, number>>((acc, h) => {
    acc[h.healthStatus] = (acc[h.healthStatus] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" subtitle={`${apiaries.length} apiaries · ${hives.length} hives`} />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile icon={<MapPin size={20} />} value={apiaries.length} label="Apiaries" to="/apiaries" color="bg-emerald-50 text-emerald-600" />
        <StatTile icon={<Boxes size={20} />} value={hives.length} label="Hives" to="/hives" color="bg-honey-50 text-honey-600" />
        <StatTile icon={<Thermometer size={20} />} value={sensors.length} label="Sensors" to="/sensors" color="bg-sky-50 text-sky-600" />
        <StatTile icon={<ClipboardList size={20} />} value={inspections.length} label="Inspections" to="/inspections" color="bg-purple-50 text-purple-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Health overview */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <TrendingUp size={16} className="text-honey-600" /> Health Overview
            </h3>
            <Link to="/hives" className="text-xs text-honey-600 font-medium">View all →</Link>
          </div>
          <div className="space-y-2">
            {HEALTH_META_ORDER.map((key) => {
              const count = healthCounts[key] ?? 0;
              if (count === 0 && key !== 'good') return null;
              const meta = HEALTH_META[key];
              const pct = hives.length > 0 ? (count / hives.length) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className={`text-xs font-medium w-16 ${meta.text}`}>{meta.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-stone-100 overflow-hidden">
                    <div className={`h-full ${meta.dot} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-stone-400 w-6 text-right">{count}</span>
                </div>
              );
            })}
            {hives.length === 0 && <p className="text-xs text-stone-400">No hives yet.</p>}
          </div>
        </Card>

        {/* Tasks due */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <CheckSquare size={16} className="text-honey-600" /> Tasks Due
            </h3>
            <Link to="/tasks" className="text-xs text-honey-600 font-medium">All tasks →</Link>
          </div>
          {dueTasks.length === 0 ? (
            <p className="text-xs text-stone-400">No overdue tasks. 🎉</p>
          ) : (
            <div className="space-y-2">
              {dueTasks.slice(0, 4).map((t) => {
                return (
                  <Link
                    key={t.id}
                    to="/tasks"
                    className="flex items-center gap-2 py-1.5 group"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-stone-400'}`} />
                    <span className="text-sm text-stone-700 truncate flex-1 group-hover:text-honey-700">{t.title}</span>
                    {t.dueDate && (
                      <span className="text-[10px] text-red-500">
                        {isToday(new Date(t.dueDate)) ? 'Today' : formatDistanceToNow(new Date(t.dueDate), { addSuffix: true })}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Recent inspections */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <ClipboardList size={16} className="text-honey-600" /> Recent Inspections
            </h3>
            <Link to="/inspections" className="text-xs text-honey-600 font-medium">All →</Link>
          </div>
          {recentInspections.length === 0 ? (
            <p className="text-xs text-stone-400">No inspections recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {recentInspections.map((i) => {
                const hiveName = hives.find((h) => h.id === i.hiveId)?.name ?? 'Unknown hive';
                const meta = HEALTH_META[i.healthStatus];
                return (
                  <Link key={i.id} to={`/inspections/${i.id}`} className="flex items-center gap-2.5 py-1 group">
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-stone-700 truncate group-hover:text-honey-700">{hiveName}</div>
                      <div className="text-[10px] text-stone-400">
                        {formatDistanceToNow(new Date(i.date), { addSuffix: true })}
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Sensor overview */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <Thermometer size={16} className="text-sky-600" /> Sensor Overview
            </h3>
            <Link to="/sensors" className="text-xs text-sky-600 font-medium">All →</Link>
          </div>
          {hivesWithSensors.length === 0 ? (
            <p className="text-xs text-stone-400">No hives with sensors assigned.</p>
          ) : (
            <div className="space-y-2.5">
              {hivesWithSensors.map((h) => {
                const hiveSensors = sensors.filter((s) => s.hiveId === h.id);
                const r = hiveSensors.find((s) => s.latestReading)?.latestReading;
                return (
                  <Link key={h.id} to={`/hives/${h.id}`} className="flex items-center gap-2.5 py-1 group">
                    <Thermometer size={14} className="text-sky-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-stone-700 truncate group-hover:text-sky-700">{h.name}</div>
                      <div className="text-[10px] text-stone-400">{HIVE_TYPES[h.type].label}</div>
                    </div>
                    {r && (
                      <div className="text-right">
                        <div className="text-sm font-semibold text-orange-600">{r.temperature.toFixed(1)}°F</div>
                        <div className="text-[10px] text-sky-600">{r.humidity.toFixed(0)}%</div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {hives.length === 0 && apiaries.length === 0 && (
        <div className="mt-6 bg-honey-50 border border-honey-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-honey-600 shrink-0" />
          <p className="text-sm text-honey-800">
            Welcome to BeeLog! Sample data has been seeded. Go to <Link to="/settings" className="underline font-medium">Settings</Link> to reset or clear data.
          </p>
        </div>
      )}
    </div>
  );
}

const HEALTH_META_ORDER = ['excellent', 'good', 'fair', 'poor', 'critical'] as const;

function StatTile({ icon, value, label, to, color }: { icon: React.ReactNode; value: number; label: string; to: string; color: string }) {
  return (
    <Link to={to} className="bg-white rounded-2xl shadow-card border border-stone-100 p-3.5 flex flex-col gap-2 active:scale-[0.98] transition-transform">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-stone-800 leading-none">{value}</div>
        <div className="text-[11px] text-stone-400 mt-0.5">{label}</div>
      </div>
    </Link>
  );
}