import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, AlertTriangle, Thermometer, Bug, Crown, Flower2, Calendar, Activity, CloudRain, MessageCircle } from 'lucide-react';
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

// Type → icon + accent color
const TYPE_CONFIG: Record<string, { icon: typeof Activity; accent: string; accentSoft: string }> = {
  season:    { icon: Flower2,       accent: '#f59e0b', accentSoft: 'rgba(245,158,11,0.12)' },
  forage:    { icon: Flower2,       accent: '#50c17b', accentSoft: 'rgba(80,193,123,0.12)' },
  swarm:     { icon: AlertTriangle, accent: '#ef4444', accentSoft: 'rgba(239,68,68,0.12)' },
  schedule:  { icon: Calendar,      accent: '#0a84ff', accentSoft: 'rgba(10,132,255,0.12)' },
  colony:    { icon: Crown,          accent: '#a855f7', accentSoft: 'rgba(168,85,247,0.12)' },
  weather:   { icon: CloudRain,     accent: '#38bdf8', accentSoft: 'rgba(56,189,248,0.12)' },
  sensor:    { icon: Thermometer,   accent: '#ff9f0a', accentSoft: 'rgba(255,159,10,0.12)' },
  treatment: { icon: Bug,           accent: '#ff453a', accentSoft: 'rgba(255,69,58,0.12)' },
};

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  urgent:   { label: 'URGENT',  bg: 'rgba(239,68,68,0.15)',  text: '#ef4444' },
  warning:  { label: 'WATCH',   bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
  info:     { label: '',        bg: '',                      text: '' },
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

// Per-type prompt templates for "Ask Buzz"
const TYPE_PROMPT: Record<string, (i: Insight) => string> = {
  season:   (i) => `We're in ${i.title} season (${i.summary}). What should I be doing right now as a beekeeper in Middle Georgia?`,
  forage:   (i) => `Current forage: ${i.summary}. ${i.detail}. How should I manage supers and colony nutrition during this flow?`,
  swarm:    (i) => `I have swarm risk on: ${i.summary}. ${i.detail}. What's my action plan to prevent swarming?`,
  schedule: (i) => `I have overdue inspections: ${i.summary}. ${i.detail}. What should I prioritize checking when I open these hives?`,
  colony:   (i) => `Colony status: ${i.summary}. ${i.detail}. What does this confidence level mean and how should I verify the colony state?`,
  weather:  (i) => `Weather window: ${i.summary}. ${i.detail}. Is it safe to inspect right now? What conditions should I watch for?`,
  sensor:   (i) => `Sensor alert: ${i.summary}. ${i.detail}. What could cause this and how do I troubleshoot the sensor?`,
  treatment:(i) => `Treatment needed: ${i.summary}. ${i.detail}. What treatment protocol should I follow and when?`,
};

export function InsightCards() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();

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

  const askBuzz = (insight: Insight, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const promptFn = TYPE_PROMPT[insight.type];
    const prompt = promptFn ? promptFn(insight) : `Tell me about: ${insight.title}. ${insight.summary} ${insight.detail}`;
    navigate('/chat', { state: { initialPrompt: prompt } });
  };

  if (loading) {
    return (
      <div className="space-y-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-100 dark:border-slate-800 p-3.5 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-stone-100 dark:bg-slate-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded bg-stone-100 dark:bg-slate-800" />
                <div className="h-2.5 w-48 rounded bg-stone-100 dark:bg-slate-800" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || insights.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2.5">
      {insights.slice(0, 8).map((insight) => {
        const tc = TYPE_CONFIG[insight.type] ?? TYPE_CONFIG.sensor;
        const pc = PRIORITY_CONFIG[insight.priority] ?? PRIORITY_CONFIG.info;
        const link = TYPE_LINK[insight.type] ?? '/';
        const Icon = tc.icon;

        return (
          <Link
            key={insight.id}
            to={link}
            className="group relative block bg-white dark:bg-slate-900 rounded-2xl border border-stone-100 dark:border-slate-800 overflow-hidden transition-all hover:shadow-md hover:border-stone-200 dark:hover:border-slate-700 hover:-translate-y-px"
            style={{ paddingLeft: '20px' }}
          >
            {/* Left accent bar — colored by type */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[5px] transition-all group-hover:w-[6px]"
              style={{ background: tc.accent }}
            />

            <div className="flex items-start gap-3 p-3.5">
              {/* Icon in a soft-colored rounded square */}
              <div
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105"
                style={{ background: tc.accentSoft }}
              >
                <Icon size={17} style={{ color: tc.accent }} strokeWidth={2.2} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[13px] font-bold text-stone-800 dark:text-slate-100 truncate">
                    {insight.title}
                  </span>
                  {pc.label && (
                    <span
                      className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
                      style={{ background: pc.bg, color: pc.text }}
                    >
                      {pc.label}
                    </span>
                  )}
                </div>

                <p className="text-[12.5px] text-stone-600 dark:text-slate-300 leading-snug">
                  {insight.summary}
                </p>

                {insight.detail && (
                  <p className="text-[11px] text-stone-400 dark:text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {insight.detail}
                  </p>
                )}

                {/* Ask Buzz button */}
                <button
                  onClick={(e) => askBuzz(insight, e)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  style={{
                    color: tc.accent,
                    borderColor: `${tc.accent}40`,
                    background: tc.accentSoft,
                  }}
                >
                  <MessageCircle size={11} strokeWidth={2.2} />
                  Ask Buzz
                </button>
              </div>

              {/* Chevron */}
              <ChevronRight
                size={16}
                className="shrink-0 mt-1 text-stone-300 dark:text-slate-600 transition-all group-hover:text-stone-500 dark:group-hover:text-slate-400 group-hover:translate-x-0.5"
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}