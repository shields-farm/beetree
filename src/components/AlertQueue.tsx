import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Thermometer, Bug, Crown, Flower2, Calendar, Activity,
  CloudRain, ChevronRight, MessageCircle, CheckCircle2, Loader2, ArrowRight,
} from 'lucide-react';
import { apiFetch } from '../lib/apiBase';
import { generateAlerts, type Alert } from '../lib/alerts';
import { useStore } from '../store/useStore';

// ─── Ontology insight (server-generated) ─────────────────────────────────────
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

// ─── Unified queue item ──────────────────────────────────────────────────────
type Severity = 'urgent' | 'warning' | 'info';

interface QueueItem {
  id: string;
  severity: Severity;
  title: string;
  /** One-line body */
  body: string;
  /** Where tapping the row goes */
  route: string;
  /** Inline call-to-action label — omitted when the row is informational */
  cta?: string;
  /** Route the CTA button uses (defaults to `route`) */
  ctaRoute?: string;
  icon: typeof Activity;
  accent: string;
  accentSoft: string;
  /** Prompt handed to Buzz for the per-row "Ask Buzz" affordance */
  prompt?: string;
  source: 'alert' | 'insight';
}

const SEVERITY_RANK: Record<Severity, number> = { urgent: 0, warning: 1, info: 2 };

const SEVERITY_META: Record<Severity, { label: string; bg: string; text: string; border: string; dot: string }> = {
  urgent: {
    label: 'URGENT',
    bg: 'bg-red-50 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-900',
    dot: 'bg-red-500',
  },
  warning: {
    label: 'WATCH',
    bg: 'bg-amber-50 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
  },
  info: {
    label: '',
    bg: '',
    text: '',
    border: 'border-stone-200 dark:border-stone-800',
    dot: 'bg-sky-500',
  },
};

const INSIGHT_LOOK: Record<string, { icon: typeof Activity; accent: string; soft: string; route: string }> = {
  season: { icon: Flower2, accent: '#f59e0b', soft: 'rgba(245,158,11,0.12)', route: '/forage' },
  forage: { icon: Flower2, accent: '#50c17b', soft: 'rgba(80,193,123,0.12)', route: '/forage' },
  swarm: { icon: AlertTriangle, accent: '#ef4444', soft: 'rgba(239,68,68,0.12)', route: '/hives?tab=swarm' },
  schedule: { icon: Calendar, accent: '#0a84ff', soft: 'rgba(10,132,255,0.12)', route: '/inspections' },
  colony: { icon: Crown, accent: '#a855f7', soft: 'rgba(168,85,247,0.12)', route: '/hives' },
  weather: { icon: CloudRain, accent: '#38bdf8', soft: 'rgba(56,189,248,0.12)', route: '/inspections' },
  sensor: { icon: Thermometer, accent: '#ff9f0a', soft: 'rgba(255,159,10,0.12)', route: '/sensors' },
  treatment: { icon: Bug, accent: '#ff453a', soft: 'rgba(255,69,58,0.12)', route: '/hives?tab=treatments' },
};

const ALERT_ICON: Record<Alert['category'], { icon: typeof Activity; accent: string; soft: string }> = {
  inspection: { icon: Calendar, accent: '#0a84ff', soft: 'rgba(10,132,255,0.12)' },
  sensor: { icon: Thermometer, accent: '#ff9f0a', soft: 'rgba(255,159,10,0.12)' },
  task: { icon: CheckCircle2, accent: '#8b5cf6', soft: 'rgba(139,92,246,0.12)' },
  seasonal: { icon: Flower2, accent: '#f59e0b', soft: 'rgba(245,158,11,0.12)' },
  health: { icon: AlertTriangle, accent: '#ef4444', soft: 'rgba(239,68,68,0.12)' },
};

const INSIGHT_PROMPT: Record<string, (i: Insight) => string> = {
  season: (i) => `We're in ${i.title} season (${i.summary}). What should I be doing right now as a beekeeper in Middle Georgia?`,
  forage: (i) => `Current forage: ${i.summary}. ${i.detail}. How should I manage supers and colony nutrition during this flow?`,
  swarm: (i) => `I have swarm risk on: ${i.summary}. ${i.detail}. What's my action plan to prevent swarming?`,
  schedule: (i) => `I have overdue inspections: ${i.summary}. ${i.detail}. What should I prioritize checking when I open these hives?`,
  colony: (i) => `Colony status: ${i.summary}. ${i.detail}. What does this confidence level mean and how should I verify the colony state?`,
  weather: (i) => `Weather window: ${i.summary}. ${i.detail}. Is it safe to inspect right now? What conditions should I watch for?`,
  sensor: (i) => `Sensor alert: ${i.summary}. ${i.detail}. What could cause this and how do I troubleshoot the sensor?`,
  treatment: (i) => `Treatment needed: ${i.summary}. ${i.detail}. What treatment protocol should I follow and when?`,
};

// ─── Alert → queue item ──────────────────────────────────────────────────────
function fromAlert(a: Alert): QueueItem {
  const look = ALERT_ICON[a.category] ?? ALERT_ICON.task;
  return {
    id: a.id,
    severity: a.severity,
    title: a.title,
    body: a.message,
    route: a.actionRoute ?? '/tasks',
    cta: a.actionLabel,
    ctaRoute: a.actionRoute,
    icon: look.icon,
    accent: look.accent,
    accentSoft: look.soft,
    source: 'alert',
  };
}

// ─── Insight → queue item ────────────────────────────────────────────────────
function fromInsight(i: Insight): QueueItem {
  const look = INSIGHT_LOOK[i.type] ?? INSIGHT_LOOK.sensor;
  const promptFn = INSIGHT_PROMPT[i.type];
  return {
    id: i.id,
    severity: i.priority,
    title: i.title,
    body: i.detail || i.summary,
    route: look.route,
    icon: look.icon,
    accent: look.accent,
    accentSoft: look.soft,
    prompt: promptFn ? promptFn(i) : `Tell me about: ${i.title}. ${i.summary} ${i.detail}`,
    source: 'insight',
  };
}

/**
 * One prioritized alert queue for the Dashboard.
 *
 * Previously the dashboard rendered one big card plus three chips and pushed
 * everything else behind a "+N more" link, while the tab badge stayed at zero —
 * so the loudest number in the app was invisible and actionable items like a
 * 46-day-overdue varroa follow-up never surfaced. This merges the local
 * heuristic alerts with the server ontology insights into a single ranked
 * queue where every row is tappable and every actionable row carries its CTA.
 */
export function AlertQueue() {
  const { hives, inspections, sensors, tasks } = useStore();
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch('/api/ontology/insights');
        const data: InsightsResponse = await resp.json();
        if (!cancelled) setInsights(data.insights ?? []);
      } catch {
        if (!cancelled) setInsights([]);
      } finally {
        if (!cancelled) setLoadingInsights(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const alerts = useMemo(
    () => generateAlerts(hives, inspections, sensors, tasks),
    [hives, inspections, sensors, tasks],
  );

  const queue = useMemo<QueueItem[]>(() => {
    const items = [
      ...alerts.map(fromAlert),
      ...insights.map(fromInsight),
    ];
    // De-dupe by title — an overdue-inspection alert and its ontology insight
    // are the same fact arriving on two channels; prefer the heuristic alert
    // because it carries a per-hive action route.
    const seen = new Set<string>();
    const deduped: QueueItem[] = [];
    for (const it of items) {
      const key = it.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }
    return deduped.sort((a, b) => {
      const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (s !== 0) return s;
      // Within a severity, anything with a concrete action outranks a report
      const aAct = a.cta ? 0 : 1;
      const bAct = b.cta ? 0 : 1;
      return aAct - bAct;
    });
  }, [alerts, insights]);

  const urgent = queue.filter((q) => q.severity === 'urgent');
  const hero = queue.find((q) => q.severity === 'urgent' && q.cta) ?? queue[0] ?? null;
  const rest = queue.filter((q) => q.id !== hero?.id);
  const visible = showAll ? rest : rest.slice(0, 6);

  if (loadingInsights && queue.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-400 dark:text-stone-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!hero) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 text-center">
        <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-600 dark:text-emerald-400" />
        <p className="text-base text-emerald-700 dark:text-emerald-300 font-semibold">All caught up</p>
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
          Nothing urgent right now. Go enjoy your bees.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Do this next ───────────────────────────────────────────── */}
      <HeroCard item={hero} urgentCount={urgent.length} onAsk={() => hero.prompt && navigate('/chat', { state: { initialPrompt: hero.prompt } })} />

      {/* ── The rest of the queue ──────────────────────────────────── */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider">
              Then {rest.length} more
            </span>
            {rest.length > 6 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-[11px] font-medium text-honey-600 dark:text-honey-400"
              >
                {showAll ? 'Show less' : `Show all ${rest.length}`}
              </button>
            )}
          </div>
          {visible.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              onAsk={() => item.prompt && navigate('/chat', { state: { initialPrompt: item.prompt } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Hero: the single most important thing ───────────────────────────────────
function HeroCard({ item, urgentCount, onAsk }: { item: QueueItem; urgentCount: number; onAsk: () => void }) {
  const meta = SEVERITY_META[item.severity];
  const Icon = item.icon;

  return (
    <div className={`rounded-2xl border-2 ${meta.border} ${meta.bg} overflow-hidden`}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${meta.dot} ${item.severity === 'urgent' ? 'animate-pulse' : ''}`} />
          <span className={`text-[10px] font-extrabold uppercase tracking-wider ${meta.text}`}>
            {item.severity === 'urgent' ? 'Do this next' : 'Worth a look'}
          </span>
          {urgentCount > 1 && (
            <span className={`ml-auto text-[10px] font-medium ${meta.text}`}>
              {urgentCount} urgent total
            </span>
          )}
        </div>

        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: item.accentSoft }}
          >
            <Icon size={19} style={{ color: item.accent }} strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-base font-bold ${meta.text}`}>{item.title}</div>
            <p className="text-sm text-stone-700 dark:text-stone-200 mt-1 leading-relaxed">{item.body}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Link
            to={item.ctaRoute ?? item.route}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-honey-700 dark:text-honey-300 bg-white/80 dark:bg-stone-900/80 px-4 py-2 rounded-xl hover:bg-white dark:hover:bg-stone-900 transition-colors"
          >
            {item.cta ?? 'Open'}
            <ArrowRight size={15} />
          </Link>
          {item.prompt && (
            <button
              onClick={onAsk}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 dark:text-stone-300 px-3 py-2 rounded-xl hover:bg-white/60 dark:hover:bg-stone-900/60 transition-colors"
            >
              <MessageCircle size={14} />
              Ask Buzz
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function QueueRow({ item, onAsk }: { item: QueueItem; onAsk: () => void }) {
  const meta = SEVERITY_META[item.severity];
  const Icon = item.icon;

  return (
    <div className="relative group bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 overflow-hidden transition-all hover:shadow-md hover:border-stone-200 dark:hover:border-stone-700">
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: item.accent }} />

      <Link to={item.route} className="flex items-start gap-3 p-3.5 pl-5">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: item.accentSoft }}
        >
          <Icon size={17} style={{ color: item.accent }} strokeWidth={2.2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-bold text-stone-800 dark:text-stone-100 truncate">
              {item.title}
            </span>
            {meta.label && (
              <span
                className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${meta.bg} ${meta.text}`}
              >
                {meta.label}
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-stone-600 dark:text-stone-300 leading-snug line-clamp-2">
            {item.body}
          </p>
        </div>

        <ChevronRight
          size={16}
          className="shrink-0 mt-1 text-stone-300 dark:text-stone-600 transition-all group-hover:text-stone-500 dark:group-hover:text-stone-400 group-hover:translate-x-0.5"
        />
      </Link>

      {/* Inline actions */}
      <div className="flex items-center gap-2 px-3.5 pb-3 pl-5">
        {item.cta && (
          <Link
            to={item.ctaRoute ?? item.route}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
            style={{ color: item.accent, borderColor: `${item.accent}40`, background: item.accentSoft }}
          >
            {item.cta}
            <ArrowRight size={11} />
          </Link>
        )}
        {item.prompt && (
          <button
            onClick={onAsk}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 dark:text-stone-400 px-2.5 py-1 rounded-full border border-stone-200 dark:border-stone-800 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
          >
            <MessageCircle size={11} />
            Ask Buzz
          </button>
        )}
      </div>
    </div>
  );
}
