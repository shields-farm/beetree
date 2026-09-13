import { useState, useEffect, useCallback } from 'react';
import { Search, Clock, AlertCircle, Info, Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { API_BASE, apiFetch } from '../lib/apiBase';

interface LogEntry {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  hiveId: string | null;
  hiveName: string | null;
  title: string;
  body: string;
  severity: string;
  metadata: Record<string, any>;
  delivered: boolean;
}

interface LogStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  last24h: number;
  last7d: number;
}

const SEVERITY_META: Record<string, { icon: typeof Info; color: string; bg: string; border: string }> = {
  urgent: { icon: AlertCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950', border: 'border-red-200 dark:border-red-900' },
  warning: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950', border: 'border-amber-200 dark:border-amber-900' },
  info: { icon: Info, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950', border: 'border-sky-200 dark:border-sky-900' },
};

const TYPE_LABELS: Record<string, string> = {
  'briefing': 'Briefing',
  'weekly-review': 'Weekly Review',
  'post-inspection': 'Post-Inspection',
  'nudge': 'Nudge',
  'alert': 'Alert',
  'tool-call': 'Tool Call',
  'buzz-chat': 'Chat',
  'feeding-nudge': 'Feeding Nudge',
  'weight-alert': 'Weight Alert',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function ActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const limit = 50;

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      if (severityFilter) params.set('severity', severityFilter);
      params.set('limit', String(limit));
      params.set('offset', String(offset));

      const resp = await apiFetch(`${API_BASE}/api/agentic-log?${params}`);
      if (resp.ok) {
        const data = await resp.json();
        setEntries(data.entries);
        setTotal(data.total);
      }
    } catch { /* server not running */ }
    setLoading(false);
  }, [search, typeFilter, severityFilter, offset]);

  const fetchStats = useCallback(async () => {
    try {
      const resp = await apiFetch(`${API_BASE}/api/agentic-log/stats`);
      if (resp.ok) setStats(await resp.json());
    } catch { /* skip */ }
  }, []);

  useEffect(() => { fetchLog(); }, [fetchLog]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto px-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Activity size={22} className="text-honey-600 dark:text-honey-400" />
        <div>
          <h1 className="text-lg font-bold text-stone-800 dark:text-stone-100">Activity Log</h1>
          <p className="text-[11px] text-stone-400 dark:text-stone-500">Agentic activity — briefings, nudges, alerts, tool calls</p>
        </div>
        <button
          onClick={() => { fetchLog(); fetchStats(); }}
          className="ml-auto p-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{stats.total}</div>
            <div className="text-[11px] text-stone-400">Total events</div>
          </div>
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
            <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">{stats.last24h}</div>
            <div className="text-[11px] text-stone-400">Last 24h</div>
          </div>
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.bySeverity.urgent ?? 0}</div>
            <div className="text-[11px] text-stone-400">Urgent</div>
          </div>
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3">
            <div className="text-2xl font-bold text-amber-500">{stats.bySeverity.warning ?? 0}</div>
            <div className="text-[11px] text-stone-400">Warnings</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="Search activity..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
          className="text-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2"
        >
          <option value="">All types</option>
          <option value="briefing">Briefings</option>
          <option value="weekly-review">Weekly Reviews</option>
          <option value="post-inspection">Post-Inspections</option>
          <option value="nudge">Nudges</option>
          <option value="alert">Alerts</option>
          <option value="tool-call">Tool Calls</option>
          <option value="buzz-chat">Chats</option>
          <option value="feeding-nudge">Feeding</option>
          <option value="weight-alert">Weight</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setOffset(0); }}
          className="text-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2"
        >
          <option value="">All severity</option>
          <option value="urgent">Urgent</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* Entries */}
      <div className="space-y-2">
        {entries.length === 0 && !loading && (
          <div className="text-center py-12 text-stone-400 dark:text-stone-500 text-sm">
            No activity logged yet. Briefings and nudges will appear here.
          </div>
        )}
        {entries.map((entry) => {
          const meta = SEVERITY_META[entry.severity] ?? SEVERITY_META.info;
          const Icon = meta.icon;
          const isExpanded = expanded.has(entry.id);

          return (
            <div
              key={entry.id}
              className={`rounded-xl border ${meta.border} ${meta.bg} overflow-hidden cursor-pointer transition-all`}
              onClick={() => toggleExpand(entry.id)}
            >
              <div className="flex items-start gap-3 p-3">
                <div className={`shrink-0 mt-0.5 ${meta.color}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate">
                      {entry.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                      {TYPE_LABELS[entry.type] ?? entry.type}
                    </span>
                    {entry.hiveName && (
                      <span className="text-[10px] text-stone-400">
                        · {entry.hiveName}
                      </span>
                    )}
                  </div>
                  {!isExpanded && entry.body && (
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2">{entry.body}</p>
                  )}
                  {isExpanded && entry.body && (
                    <pre className="text-xs text-stone-600 dark:text-stone-300 mt-2 whitespace-pre-wrap font-sans">{entry.body}</pre>
                  )}
                  {isExpanded && Object.keys(entry.metadata).length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-stone-400 cursor-pointer">Metadata</summary>
                      <pre className="text-[10px] text-stone-400 mt-1 whitespace-pre-wrap">{JSON.stringify(entry.metadata, null, 2)}</pre>
                    </details>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {entry.delivered && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">sent</span>
                  )}
                  <span className="text-[10px] text-stone-400 whitespace-nowrap flex items-center gap-1">
                    <Clock size={10} />
                    {timeAgo(entry.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 disabled:opacity-40 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            ← Newer
          </button>
          <span className="text-xs text-stone-400">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 disabled:opacity-40 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}