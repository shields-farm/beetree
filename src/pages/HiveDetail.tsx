import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Pencil, Thermometer, ClipboardList, ChevronRight, Boxes } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { Card } from '../components/Card';
import { GpsPin } from '../components/GpsPin';
import { HiveVisual } from '../components/HiveVisual';
import { SensorCard } from '../components/SensorCard';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import type { HiveType } from '../types';

export function HiveDetail({ id }: { id: string }) {
  const { hives, apiaries, inspections, sensors, updateHive, deleteHive, assignSensor, refreshSensorReadings } = useStore();
  const { setQuickQuestions } = useChat();
  const navigate = useNavigate();
  const hive = hives.find((h) => h.id === id);
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

  // These are now computed above (before the early return)
  // const apiary, meta, hiveInspections, hiveSensors moved up

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
          }}
          className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 flex items-center justify-center shrink-0"
        >
          <Pencil size={16} />
        </button>
      </div>

      {/* Health + quick stats */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className={`text-xs px-2.5 py-1 rounded-full ${meta!.bg} ${meta!.text} font-medium`}>Health: {meta!.label}</span>
        <span className="text-xs px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">{hive.boxes.length} box{hive.boxes.length !== 1 ? 'es' : ''}</span>
        {hiveSensors.length > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 flex items-center gap-1">
            <Thermometer size={11} /> {hiveSensors.length} sensor{hiveSensors.length !== 1 ? 's' : ''}
          </span>
        )}
        <AskAIButton prompt={`Give me a full assessment of ${hive.name}: queen health, nutrition, pests/diseases. What should I be watching for?`} label="Assess this hive" />
      </div>

      {/* GPS Location Pin */}
      <div className="mb-4">
        <GpsPin
          hive={hive}
          onPin={(location) => updateHive(hive.id, { location })}
          onClear={() => updateHive(hive.id, { location: undefined })}
        />
      </div>

      {editing && (
        <Card className="mb-4 animate-fade-in">
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

      {/* Sensor readings */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
            <Thermometer size={16} className="text-sky-600" /> Live Sensors
          </h3>
          <button
            onClick={refreshSensorReadings}
            className="text-xs text-sky-600 font-medium"
          >
            Refresh
          </button>
        </div>
        {hiveSensors.length > 0 && (
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
        )}
        {/* Assign unassigned sensors */}
        {unassignedSensors.length > 0 && (
          <div className="mt-3">
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
      </div>

      {/* Hive visual editor */}
      <div className="mb-4">
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

      {/* Notes */}
      {hive.notes && (
        <Card className="mb-4">
          <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">{hive.notes}</p>
        </Card>
      )}

      {/* Inspections */}
      <div className="mb-4">
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
    </div>
  );
}