import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/apiBase';

interface Insight {
  id: string;
  type: string;
  emoji: string;
  color: string;
  title: string;
  summary: string;
  detail: string;
  priority: 'urgent' | 'warning' | 'info';
}

interface InsightsResponse {
  insights: Insight[];
  generatedAt: string;
  season: string;
}

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  red: { bg: 'bg-red-50 dark:bg-red-950', border: 'border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  sky: { bg: 'bg-sky-50 dark:bg-sky-950', border: 'border-sky-200 dark:border-sky-800', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  stone: { bg: 'bg-stone-50 dark:bg-stone-900', border: 'border-stone-200 dark:border-stone-800', text: 'text-stone-700 dark:text-stone-300', dot: 'bg-stone-500' },
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: 'border-l-4 border-l-red-500',
  warning: 'border-l-4 border-l-amber-500',
  info: 'border-l-4 border-l-stone-300 dark:border-l-stone-700',
};

const TYPE_LINK: Record<string, string> = {
  swarm: '/swarm',
  schedule: '/inspections',
  sensor: '/sensors',
  treatment: '/treatments',
  forage: '/forage',
  colony: '/hives',
  weather: '/',
  season: '/',
};

export function InsightCards() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const resp = await apiFetch('/api/ontology/insights');
      const data: InsightsResponse = await resp.json();
      setInsights(data.insights ?? []);
    } catch {
      setError(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-honey-500" />
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">AI Insights</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-stone-100 dark:bg-stone-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || insights.length === 0) {
    return null;
  }

  const c = COLOR_MAP;

  return (
    <div className="space-y-2">
      {insights.slice(0, 8).map((insight) => {
          const colors = c[insight.color] ?? c.stone;
          const link = TYPE_LINK[insight.type] ?? '/';
          return (
            <Link
              key={insight.id}
              to={link}
              className={`block ${PRIORITY_BORDER[insight.priority] ?? PRIORITY_BORDER.info} ${colors.bg} ${colors.border} border rounded-xl p-3 hover:shadow-sm transition-all`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0 leading-5">{insight.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${colors.text}`}>{insight.title}</span>
                    {insight.priority === 'urgent' && (
                      <span className="text-[9px] font-bold uppercase text-red-600 dark:text-red-400">urgent</span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5 truncate">{insight.summary}</p>
                  {insight.detail && (
                    <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5 line-clamp-2">{insight.detail}</p>
                  )}
                </div>
                <ChevronRight size={14} className="text-stone-300 dark:text-stone-600 shrink-0 mt-0.5" />
              </div>
            </Link>
          );
        })}
    </div>
  );
}