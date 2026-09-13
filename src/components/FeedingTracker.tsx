import { useEffect, useState, useCallback } from 'react';
import { Droplets, Plus, Loader2, AlertTriangle, X } from 'lucide-react';
import { Card } from './Card';
import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';
import { describeFeed } from '../lib/format';

// ── Types (mirrors server/feeding.ts) ──────────────────────────────────────

interface FeedingEvent {
  id: string;
  hiveId: string;
  date: string;
  feedType: string;
  amount: number;
  feederType: string;
  note: string;
  refillState: 'empty' | 'partial' | 'full' | null;
  remainingAmount: number | null;
  daysSinceFill: number | null;
}

interface CalibrationFactor {
  hiveId: string;
  hiveName: string;
  factor: number;
  sampleCount: number;
  lastCalibratedAt: string | null;
  commentary: string;
}

interface FeedingStatus {
  hiveId: string;
  hiveName: string;
  lastFeeding: FeedingEvent | null;
  daysSinceLastFeeding: number | null;
  estimatedConsumptionRate: number; // mL/day
  estimatedDaysUntilEmpty: number | null;
  recommendedFeedType: { type: string; ratio: string; reason: string };
  calibration: CalibrationFactor;
  alert: string | null;
  history: FeedingEvent[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const FEED_TYPES = [
  { value: 'syrup-1:1', label: 'Syrup 1:1' },
  { value: 'syrup-2:1', label: 'Syrup 2:1' },
  { value: 'fondant', label: 'Fondant' },
  { value: 'dry-sugar', label: 'Dry Sugar' },
  { value: 'patty', label: 'Patty' },
  { value: 'pollen-patty', label: 'Pollen Patty' },
] as const;

const FEEDER_TYPES = [
  'apimaye-inner-cover',
  'frame-feeder',
  'top-feeder',
  'entrance-feeder',
  'dry-feeder',
  'other',
] as const;

const FEED_TYPE_COLORS: Record<string, string> = {
  'syrup-1:1': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'syrup-2:1': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  fondant: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  'dry-sugar': 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  patty: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'pollen-patty': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

function feedTypeLabel(ft: string): string {
  return FEED_TYPES.find((f) => f.value === ft)?.label ?? ft;
}

function feedTypeColor(ft: string): string {
  return FEED_TYPE_COLORS[ft] ?? 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200';
}

// ── Component ──────────────────────────────────────────────────────────────

export function FeedingTracker({ hiveId }: { hiveId: string }) {
  const [status, setStatus] = useState<FeedingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formFeedType, setFormFeedType] = useState<string>('syrup-1:1');
  const [formAmount, setFormAmount] = useState('');
  const [formFeederType, setFormFeederType] = useState<string>('apimaye-inner-cover');
  const [formNote, setFormNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/feeding/${hiveId}`);
      if (!res.ok) throw new Error(statusToMessage(res.status));
      const data = (await res.json()) as FeedingStatus;
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feeding data');
    } finally {
      setLoading(false);
    }
  }, [hiveId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/feeding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hiveId,
          date: new Date(formDate).toISOString(),
          feedType: formFeedType,
          amount,
          feederType: formFeederType,
          note: formNote.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? statusToMessage(res.status));
      }
      // Reset form
      setFormAmount('');
      setFormNote('');
      setShowForm(false);
      // Reload
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save feeding event');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !status) {
    return (
      <Card className="flex items-center justify-center py-6">
        <Loader2 className="animate-spin text-stone-400" size={20} />
      </Card>
    );
  }

  if (error && !status) {
    return (
      <Card className="py-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      </Card>
    );
  }

  if (!status) return null;

  const { history, calibration, alert } = status;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
          <Droplets size={16} className="text-honey-600 dark:text-honey-400" /> Feeding
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-honey-600 dark:text-honey-400 font-medium flex items-center gap-1"
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Alert banner */}
      {alert && (
        <div className="mb-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{alert}</span>
        </div>
      )}

      {/* Add feeding form */}
      {showForm && (
        <Card className="mb-3 animate-fade-in">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {/* Date */}
              <div>
                <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm bg-white dark:bg-stone-900"
                />
              </div>
              {/* Amount */}
              <div>
                <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Amount (mL/g)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  required
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm bg-white dark:bg-stone-900"
                />
              </div>
              {/* Feed Type */}
              <div>
                <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Feed Type</label>
                <select
                  value={formFeedType}
                  onChange={(e) => setFormFeedType(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none bg-white dark:bg-stone-900"
                >
                  {FEED_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                  ))}
                </select>
              </div>
              {/* Feeder Type */}
              <div>
                <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Feeder Type</label>
                <select
                  value={formFeederType}
                  onChange={(e) => setFormFeederType(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none bg-white dark:bg-stone-900"
                >
                  {FEEDER_TYPES.map((ft) => (
                    <option key={ft} value={ft}>{ft.replace(/-/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Note */}
            <div>
              <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Note</label>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="Optional notes…"
                className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm bg-white dark:bg-stone-900"
              />
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle size={12} /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-honey-500 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {saving ? 'Saving…' : 'Log Feeding Event'}
            </button>
          </form>
        </Card>
      )}

      {/* Consumption rate + calibration summary */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Card className="text-center">
          <div className="text-xs text-stone-400 dark:text-stone-500 mb-0.5">Consumption Rate</div>
          <div className="text-lg font-bold text-stone-800 dark:text-stone-100">
            {status.estimatedConsumptionRate > 0 ? `${status.estimatedConsumptionRate} mL/day` : '—'}
          </div>
          <div className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
            {calibration.factor !== 1.0
              ? `${calibration.factor}× calibrated`
              : 'base estimate'}
          </div>
        </Card>
        <Card className="text-center">
          <div className="text-xs text-stone-400 dark:text-stone-500 mb-0.5">Days Until Empty</div>
          <div className="text-lg font-bold text-stone-800 dark:text-stone-100">
            {status.estimatedDaysUntilEmpty !== null
              ? `${status.estimatedDaysUntilEmpty}d`
              : '—'}
          </div>
          <div className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
            {status.daysSinceLastFeeding !== null
              ? `${status.daysSinceLastFeeding}d since last feed`
              : 'no feeds yet'}
          </div>
        </Card>
      </div>

      {/* Calibration commentary */}
      {calibration.commentary && (
        <p className="text-[11px] text-stone-400 dark:text-stone-500 mb-3 px-1 leading-relaxed">
          {calibration.commentary}
        </p>
      )}

      {/* Recommended feed */}
      {status.recommendedFeedType && (
        <div className="mb-3 rounded-xl border border-honey-200 dark:border-honey-800 bg-honey-50 dark:bg-honey-950 px-3.5 py-2.5 text-sm text-honey-800 dark:text-honey-200 flex items-center gap-2">
          <Droplets size={14} className="shrink-0" />
          <span>
            Recommended: <strong>{describeFeed(status.recommendedFeedType.ratio, status.recommendedFeedType.type)}</strong>
            {' — '}{status.recommendedFeedType.reason}
          </span>
        </div>
      )}

      {/* Feeding history */}
      {history.length === 0 ? (
        <Card><p className="text-sm text-stone-400 dark:text-stone-500 text-center py-2">No feeding events logged yet.</p></Card>
      ) : (
        <div className="space-y-2">
          {history.map((ev) => {
            const d = new Date(ev.date);
            return (
              <Card key={ev.id}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${feedTypeColor(ev.feedType)}`}>
                        {feedTypeLabel(ev.feedType)}
                      </span>
                      <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                        {ev.amount} {ev.feedType.startsWith('syrup') ? 'mL' : 'g'}
                      </span>
                    </div>
                    <div className="text-xs text-stone-400 dark:text-stone-500">
                      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {ev.daysSinceFill != null && ev.daysSinceFill > 0 && ` · ${ev.daysSinceFill}d since last fill`}
                      {ev.feederType && ` · ${ev.feederType.replace(/-/g, ' ')}`}
                    </div>
                    {ev.note && (
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-1.5 line-clamp-2">{ev.note}</p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
