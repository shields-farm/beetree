import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { generateAlerts, ALERT_META, type Alert } from '../lib/alerts';

export function Dashboard() {
  const { hives, inspections, sensors, tasks } = useStore();
  const { setQuickQuestions } = useChat();
  const alerts = generateAlerts(hives, inspections, sensors, tasks);

  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;
  // warningCount removed — less is more

  // Page-specific quick questions
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

  // Top 3 only — less is more
  const topAlerts = alerts.slice(0, 3);
  const hasMore = alerts.length > 3;

  return (
    <div className="animate-fade-in">
      {/* "It's Time To..." — front and center, top 3 only */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={20} className="text-honey-600" />
          <h1 className="text-xl font-bold text-stone-800">It's Time To...</h1>
        </div>

        {topAlerts.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
            <p className="text-sm text-emerald-700 font-medium">All caught up 🎉</p>
            <p className="text-xs text-emerald-600 mt-1">No urgent tasks right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
            {hasMore && (
              <Link to="/tasks" className="block text-center text-xs text-stone-400 hover:text-honey-600 pt-1">
                +{alerts.length - 3} more →
              </Link>
            )}
            <div className="pt-1">
              <AskAIButton prompt="Walk me through my current alerts and what to prioritize" label="Ask AI to analyze" />
            </div>
          </div>
        )}
      </div>
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