import { Link } from 'react-router-dom';
import { Clock, ChevronRight, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { generateAlerts, ALERT_META, type Alert } from '../lib/alerts';

export function Dashboard() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();
  const alerts = generateAlerts(hives, inspections, sensors, tasks);

  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  return (
    <div className="animate-fade-in">
      {/* "It's Time To..." — front and center */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={20} className="text-honey-600" />
          <h1 className="text-xl font-bold text-stone-800">It's Time To...</h1>
          {(urgentCount > 0 || warningCount > 0) && (
            <span className="text-xs text-stone-400 ml-auto">
              {urgentCount > 0 && <span className="text-red-500 font-medium">{urgentCount} urgent</span>}
              {urgentCount > 0 && warningCount > 0 && <span className="text-stone-300 mx-1">·</span>}
              {warningCount > 0 && <span className="text-amber-600 font-medium">{warningCount} warnings</span>}
            </span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
            <p className="text-sm text-emerald-700 font-medium">All caught up 🎉</p>
            <p className="text-xs text-emerald-600 mt-1">No urgent tasks right now. Check back after your next inspection.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Minimal quick stats — just the essentials */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <QuickStat value={hives.length} label="Hives" to="/hives" />
        <QuickStat value={sensors.length} label="Sensors" to="/sensors" />
        <QuickStat value={inspections.length} label="Inspections" to="/inspections" />
      </div>

      {/* Welcome banner for empty state */}
      {hives.length === 0 && apiaries.length === 0 && (
        <div className="mt-4 bg-honey-50 border border-honey-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-honey-600 shrink-0" />
          <p className="text-sm text-honey-800">
            Welcome to BeeTree! Sample data has been seeded. Go to <Link to="/settings" className="underline font-medium">Settings</Link> to reset or clear data.
          </p>
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const meta = ALERT_META[alert.severity];
  return (
    <div className={`rounded-2xl border ${meta.border} ${meta.bg} p-3.5 flex items-start gap-3`}>
      <span className={`w-2.5 h-2.5 rounded-full ${meta.dot} mt-1.5 shrink-0`} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${meta.text}`}>{alert.title}</div>
        <div className="text-xs text-stone-600 mt-0.5 leading-relaxed">{alert.message}</div>
      </div>
      {alert.actionRoute && (
        <Link
          to={alert.actionRoute}
          className="text-xs font-medium text-honey-700 bg-white/70 px-3 py-1.5 rounded-lg shrink-0 hover:bg-white flex items-center gap-1"
        >
          {alert.actionLabel ?? 'Go'}
          <ChevronRight size={12} />
        </Link>
      )}
    </div>
  );
}

function QuickStat({ value, label, to }: { value: number; label: string; to: string }) {
  return (
    <Link to={to} className="bg-white rounded-2xl shadow-card border border-stone-100 p-3 text-center active:scale-[0.97] transition-transform">
      <div className="text-2xl font-bold text-stone-800">{value}</div>
      <div className="text-[10px] text-stone-400 mt-0.5">{label}</div>
    </Link>
  );
}