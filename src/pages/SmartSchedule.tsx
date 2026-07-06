import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  RefreshCw,
  Check,
  Plus,
} from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { useStore } from '../store/useStore';
import type { TaskPriority } from '../types';

const API_BASE = 'http://localhost:3001';

interface ScheduleFactor {
  factor: string;
  detail: string;
}

type Priority = 'urgent' | 'soon' | 'routine' | 'low';

interface InspectionRecommendation {
  hiveId: string;
  hiveName: string;
  recommendedDate: string; // ISO date
  daysUntil: number;
  priority: Priority;
  reason: string;
  factors: ScheduleFactor[];
}

const PRIORITY_META: Record<Priority, { label: string; bg: string; text: string; dot: string; border: string }> = {
  urgent: { label: 'Urgent', bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500', border: 'border-red-200' },
  soon: { label: 'Soon', bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500', border: 'border-amber-200' },
  routine: { label: 'Routine', bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500', border: 'border-green-200' },
  low: { label: 'Low', bg: 'bg-stone-100', text: 'text-stone-700', dot: 'bg-stone-400', border: 'border-stone-200' },
};

const PRIORITY_TO_TASK: Record<Priority, TaskPriority> = {
  urgent: 'high',
  soon: 'medium',
  routine: 'low',
  low: 'low',
};

export function SmartSchedule() {
  const { hives, addTask } = useStore();
  const navigate = useNavigate();

  const [recs, setRecs] = useState<InspectionRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(API_BASE + '/api/schedule');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = (await resp.json()) as InspectionRecommendation[];
      setRecs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hiveName = (id: string) => hives.find((h) => h.id === id)?.name ?? id;

  const handleAddTask = (rec: InspectionRecommendation) => {
    addTask({
      title: 'Inspect ' + hiveName(rec.hiveId),
      description: rec.reason,
      dueDate: rec.recommendedDate,
      priority: PRIORITY_TO_TASK[rec.priority],
      hiveId: rec.hiveId,
      completed: false,
    });
    setAddedIds((prev) => new Set(prev).add(rec.hiveId));
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Schedule"
        subtitle="Smart inspection recommendations for all hives"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => navigate(-1)}
              className="lg:hidden flex items-center gap-1 text-sm text-stone-500"
            >
              <ChevronLeft size={18} /> Back
            </button>
          </div>
        }
      />

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Calculating inspection schedule…
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !error && recs.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 text-center py-6">
            No hives found. Add hives to see inspection recommendations.
          </p>
        </Card>
      )}

      {!loading && !error && recs.length > 0 && (
        <div className="space-y-3">
          {recs.map((rec) => {
            const meta = PRIORITY_META[rec.priority];
            const added = addedIds.has(rec.hiveId);
            const dateStr = format(new Date(rec.recommendedDate), 'EEE, MMM d');
            return (
              <Card key={rec.hiveId}>
                {/* Header row */}
                <div className="flex items-start gap-3">
                  <div className={'shrink-0 mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center ' + meta.bg}>
                    <CalendarClock size={18} className={meta.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-stone-800 truncate">{rec.hiveName}</h3>
                      <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ' + meta.bg + ' ' + meta.text}>
                        <span className={'w-1.5 h-1.5 rounded-full ' + meta.dot} />
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {dateStr}
                      {rec.daysUntil === 0
                        ? ' · today'
                        : ' · in ' + rec.daysUntil + ' day' + (rec.daysUntil === 1 ? '' : 's')}
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <p className="text-sm text-stone-600 mt-3">{rec.reason}</p>

                {/* Factors */}
                <div className="mt-3 space-y-1.5">
                  {rec.factors.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide shrink-0 w-24">
                        {f.factor}
                      </span>
                      <span className="text-xs text-stone-500 flex-1">{f.detail}</span>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddTask(rec)}
                    disabled={added}
                    className={
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ' +
                      (added
                        ? 'bg-green-50 text-green-700 cursor-default'
                        : 'bg-honey-50 text-honey-700 hover:bg-honey-100')
                    }
                  >
                    {added ? <Check size={14} /> : <Plus size={14} />}
                    {added ? 'Added to Tasks' : 'Add to Tasks'}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && recs.length > 0 && (
        <p className="text-xs text-stone-400 text-center px-4">
          Recommendations are based on inspection history, swarm risk, health status, and the season.
        </p>
      )}
    </div>
  );
}