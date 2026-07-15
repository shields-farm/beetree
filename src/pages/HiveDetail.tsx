import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Pencil, Thermometer, ClipboardList, ChevronRight, Boxes, Activity, Settings, Droplets } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { Card } from '../components/Card';
import { GpsPin } from '../components/GpsPin';
import { HiveVisual } from '../components/HiveVisual';
import { SensorCard } from '../components/SensorCard';
import { FeedingTracker } from '../components/FeedingTracker';
import { WeightTrend } from '../components/WeightTrend';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { API_BASE, apiFetch } from '../lib/apiBase';
import type { HiveType } from '../types';

type TabId = 'overview' | 'inspections' | 'configure';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'inspections', label: 'Inspections', icon: ClipboardList },
  { id: 'configure', label: 'Configure', icon: Settings },
];

export function HiveDetail({ id }: { id: string }) {
  const { hives, apiaries, inspections, sensors, updateHive, deleteHive, assignSensor, refreshSensorReadings } = useStore();
  const { setQuickQuestions } = useChat();
  const navigate = useNavigate();
  const hive = hives.find((h) => h.id === id);
  const [tab, setTab] = useState<TabId>('overview');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(hive?.name ?? '');
  const [type, setType] = useState<HiveType>(hive?.type ?? 'langstroth-10');
  const [notes, setNotes] = useState(hive?.notes ?? '');
  const [showEditor, setShowEditor] = useState(false);

  const apiary = hive ? apiaries.find((a) => a.id === hive.apiaryId) : undefined;
  const meta = hive ? HEALTH_META[hive.healthStatus] : undefined;
  const hiveInspections = hive ? inspections.filter((i) => i.hiveId === hive.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const hiveSensors = hive ? sensors.filter((s) => s.hiveId === hive.id) : [];
  const unassignedSensors = sensors.filter((s) => !s.hiveId);

  // Page-specific quick questions about this hive
  useEffect(() => {
    if (!hive) return;
    const qs = [
      `How is ${hive.name} doing overall?`,
      `When should I next inspect ${hive.name}?`,
      `What's the queen health like in ${hive.name}?`,
    ];
    if (hiveSensors.length > 0) qs.push(`Analyze ${hive.name}'s sensor trends`);
    if (meta && (hive.healthStatus === 'poor' || hive.healthStatus === 'critical')) {
      qs.unshift(`${hive.name} is in ${meta.label} health — what should I do?`);
    }
    setQuickQuestions(qs);
    return () => setQuickQuestions([]);
  }, [hive, hiveSensors.length, meta, setQuickQuestions]);

  if (!hive) {
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400 dark:text-stone-500">Hive not found.</p>
        <Link to="/hives" className="text-honey-600 dark:text-honey-400 text-sm underline mt-2 inline-block">Back to hives</Link>
      </div>
    );
  }

  const save = () => {
    const def = HIVE_TYPES[type] || HIVE_TYPES['langstroth-10'];
    // If type changed, rebuild boxes with default config
    const boxes =
      type !== hive.type
        ? def.defaultBoxes.map((bt) => ({
            id: `box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: bt,
            frames: Array.from({ length: def.frameCountFor(bt) }, (_, i) => ({ position: i, content: 'empty' as const })),
            sensorIds: [] as string[],
          }))
        : hive.boxes;
    updateHive(hive.id, { name: name.trim() || hive.name, type, notes: notes.trim(), boxes });
    setEditing(false);
  };

  return (
    <div className="animate-fade-in">
      <Link to="/hives" className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 mb-2 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Hives
      </Link>

      {/* Header — always visible */}
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 truncate">{hive.name}</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5 truncate">
            {apiary?.name ?? '—'} · {(HIVE_TYPES[hive.type] || HIVE_TYPES['langstroth-10']).label}
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(!editing);
            setName(hive.name);
            setType(hive.type);
            setNotes(hive.notes ?? '');
            if (!editing) setTab('configure');
          }}
          className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 flex items-center justify-center shrink-0"
        >
          <Pencil size={16} />
        </button>
      </div>

      {/* Health + quick stats — always visible */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className={`text-xs px-2.5 py-1 rounded-full ${meta!.bg} ${meta!.text} font-medium`}>Health: {meta!.label}</span>
        <span className="text-xs px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">{hive.boxes.length} box{hive.boxes.length !== 1 ? 'es' : ''}</span>
        {hiveSensors.length > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 flex items-center gap-1">
            <Thermometer size={11} /> {hiveSensors.length} sensor{hiveSensors.length !== 1 ? 's' : ''}
          </span>
        )}
        <AskAIButton prompt={`Give me a full assessment of ${hive.name}: queen health, nutrition, pests/diseases. What should I be watching for?`} label="Assess" />
      </div>

      {/* Tab bar */}
      <div className="-mx-4 px-4 mb-4 overflow-x-auto">
        <div className="inline-flex gap-2 w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  tab === t.id
                    ? 'bg-honey-500 text-white'
                    : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overview tab ────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Live sensors */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
                <Thermometer size={16} className="text-sky-600" /> Live Sensors
              </h3>
              <button onClick={refreshSensorReadings} className="text-xs text-sky-600 font-medium">Refresh</button>
            </div>
            {hiveSensors.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {hiveSensors.map((s) => (
                  <div key={s.id} className="relative group">
                    <SensorCard sensor={s} onClick={() => navigate(`/sensors/${s.id}`)} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove ${s.name} from ${hive?.name ?? 'this hive'}? The sensor will remain in your sensors list.`)) {
                          assignSensor(s.id, undefined, undefined, undefined);
                        }
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 hover:bg-amber-50 dark:hover:bg-amber-950 hover:text-amber-600 dark:hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from hive (sensor stays in sensors list)"
                    >
                      <Plus size={14} className="rotate-45" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Card><p className="text-sm text-stone-400 dark:text-stone-500 text-center py-2">No sensors assigned to this hive.</p></Card>
            )}
          </div>

          {/* Weight + Feeding side by side on wider screens */}
          <ErrorBoundary>
            <WeightTrend hiveId={hive.id} />
            <FeedingSummary hiveId={hive.id} onViewHistory={() => setTab('inspections')} />
          </ErrorBoundary>

          {/* GPS compact */}
          {hive.location && (
            <GpsPin
              hive={hive}
              onPin={(location) => updateHive(hive.id, { location })}
              onClear={() => updateHive(hive.id, { location: undefined })}
              compact
            />
          )}

          {/* Notes (if any) */}
          {hive.notes && (
            <Card>
              <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">{hive.notes}</p>
            </Card>
          )}
        </div>
      )}

      {/* ── Inspections tab ─────────────────────────────────────── */}
      {tab === 'inspections' && (
        <div className="space-y-4">
          {/* Inspection list */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
                <ClipboardList size={16} className="text-honey-600 dark:text-honey-400" /> Inspections
              </h3>
              <Link to={`/inspections/new?hiveId=${hive.id}`} className="text-xs text-honey-600 dark:text-honey-400 font-medium flex items-center gap-1">
                <Plus size={14} /> New
              </Link>
            </div>
            {hiveInspections.length === 0 ? (
              <Card><p className="text-sm text-stone-400 dark:text-stone-500 text-center py-2">No inspections yet.</p></Card>
            ) : (
              <div className="space-y-2">
                {hiveInspections.map((i) => {
                  const im = HEALTH_META[i.healthStatus];
                  return (
                    <Card key={i.id} onClick={() => navigate(`/inspections/${i.id}`)} className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${im.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{format(new Date(i.date), 'MMM d, yyyy')}</div>
                        <div className="text-xs text-stone-400 dark:text-stone-500 truncate">
                          {i.queenPresent ? 'Queen ✓' : 'No queen'} · {i.notes.slice(0, 40) || '—'}
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${im.bg} ${im.text}`}>{im.label}</span>
                      <ChevronRight size={16} className="text-stone-300 dark:text-stone-600" />
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Feeding history */}
          <ErrorBoundary>
            <FeedingTracker hiveId={hive.id} />
          </ErrorBoundary>
        </div>
      )}

      {/* ── Configure tab ───────────────────────────────────────── */}
      {tab === 'configure' && (
        <div className="space-y-4">
          {/* GPS pin (full) */}
          <div>
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2 px-1">Location</h3>
            <GpsPin
              hive={hive}
              onPin={(location) => updateHive(hive.id, { location })}
              onClear={() => updateHive(hive.id, { location: undefined })}
            />
          </div>

          {/* Hive visual editor */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
                <Boxes size={16} className="text-honey-600 dark:text-honey-400" /> Hive Configuration
              </h3>
              <button
                onClick={() => setShowEditor(!showEditor)}
                className="text-xs text-honey-600 dark:text-honey-400 font-medium"
              >
                {showEditor ? 'Done editing' : 'Edit frames'}
              </button>
            </div>
            <Card>
              <HiveVisual hive={hive} editable={showEditor} showSensors />
            </Card>
          </div>

          {/* Assign unassigned sensors */}
          {unassignedSensors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2 px-1">Assign Sensor</h3>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    assignSensor(e.target.value, hive.id, undefined, undefined);
                  }
                }}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none bg-white dark:bg-stone-900"
              >
                <option value="">+ Assign a sensor to this hive…</option>
                {unassignedSensors.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.deviceId})</option>
                ))}
              </select>
            </div>
          )}

          {/* Edit details */}
          {editing && (
            <Card className="animate-fade-in">
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Hive type</label>
                  <select value={type} onChange={(e) => setType(e.target.value as HiveType)} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none">
                    {Object.values(HIVE_TYPES).map((def) => (
                      <option key={def.type} value={def.type}>{def.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">{(HIVE_TYPES[type] || HIVE_TYPES['langstroth-10']).description}</p>
                </div>
                <div>
                  <label className="text-xs text-stone-500 dark:text-stone-400 font-medium block mb-1">Notes</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm resize-y" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 text-sm">Cancel</button>
                  <button onClick={save} className="flex-1 py-2 rounded-xl bg-honey-500 text-white text-sm font-medium">Save</button>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete hive "${hive.name}" and all its inspections?`)) {
                      deleteHive(hive.id);
                      navigate('/hives');
                    }
                  }}
                  className="w-full py-2 rounded-xl border border-red-200 text-red-600 dark:text-red-400 text-sm flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={14} /> Delete hive
                </button>
              </div>
            </Card>
          )}

          {/* Notes (editable view in configure) */}
          {!editing && hive.notes && (
            <Card>
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">Notes</h3>
              <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">{hive.notes}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── FeedingSummary: compact overview-only view of feeding status ────────────
// (full history stays on the Inspections tab via FeedingTracker)

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

interface FeedingStatus {
  hiveId: string;
  hiveName: string;
  lastFeeding: FeedingEvent | null;
  daysSinceLastFeeding: number | null;
  estimatedConsumptionRate: number;
  estimatedDaysUntilEmpty: number | null;
  recommendedFeedType: { type: string; ratio: string; reason: string };
  calibration: { factor: number; commentary: string };
  alert: string | null;
  history: FeedingEvent[];
}

function FeedingSummary({ hiveId, onViewHistory }: { hiveId: string; onViewHistory: () => void }) {
  const [status, setStatus] = useState<FeedingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/feeding/${hiveId}`);
      if (!res.ok) return;
      const data = (await res.json()) as FeedingStatus;
      setStatus(data);
    } catch { /* silent — overview shouldn't break */ } finally {
      setLoading(false);
    }
  }, [hiveId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (!status) return null;

  const hasData = status.history.length > 0 || status.lastFeeding;

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
          <Droplets size={16} className="text-honey-600 dark:text-honey-400" /> Feeding
        </h3>
        {hasData && (
          <button onClick={onViewHistory} className="text-xs text-honey-600 dark:text-honey-400 font-medium">
            View history →
          </button>
        )}
      </div>

      {status.alert && (
        <div className="mb-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <span>⚠️</span>
          <span>{status.alert}</span>
        </div>
      )}

      {hasData ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-stone-400 dark:text-stone-500 mb-0.5">Consumption</div>
            <div className="text-base font-bold text-stone-800 dark:text-stone-100">
              {status.estimatedConsumptionRate > 0 ? `${status.estimatedConsumptionRate} mL/day` : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-400 dark:text-stone-500 mb-0.5">Days until empty</div>
            <div className="text-base font-bold text-stone-800 dark:text-stone-100">
              {status.estimatedDaysUntilEmpty !== null ? `${status.estimatedDaysUntilEmpty}d` : '—'}
            </div>
            <div className="text-[11px] text-stone-400 dark:text-stone-500">
              {status.daysSinceLastFeeding !== null ? `${status.daysSinceLastFeeding}d since last` : ''}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-stone-400 dark:text-stone-500">No feeding events logged.</p>
      )}

      {status.recommendedFeedType && hasData && (
        <div className="mt-3 text-xs text-honey-700 dark:text-honey-300 flex items-center gap-1.5">
          <Droplets size={12} className="shrink-0" />
          Recommended: <strong>{status.recommendedFeedType.ratio} {status.recommendedFeedType.type}</strong>
        </div>
      )}
    </div>
  );
}