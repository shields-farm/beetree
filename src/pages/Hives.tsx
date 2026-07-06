import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Boxes, Thermometer, ChevronRight, MapPin } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { HIVE_TYPES, makeEmptyFrames } from '../lib/hiveTypes';
import { HEALTH_META } from '../lib/health';
import type { HiveType } from '../types';

export function Hives({ apiaryFilter }: { apiaryFilter?: string }) {
  const { hives, apiaries, addHive } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [apiaryId, setApiaryId] = useState(apiaryFilter ?? apiaries[0]?.id ?? '');
  const [type, setType] = useState<HiveType>('langstroth-10');

  // Filter hives by selected apiary when apiaryFilter is provided
  const visibleHives = apiaryFilter
    ? hives.filter((h) => h.apiaryId === apiaryFilter)
    : hives;

  const handleAdd = () => {
    if (!name.trim() || !apiaryId) return;
    const def = HIVE_TYPES[type];
    const boxes = def.defaultBoxes.map((bt) => ({
      id: `box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: bt,
      frames: makeEmptyFrames(def.frameCountFor(bt)),
      sensorIds: [] as string[],
    }));
    addHive({
      apiaryId,
      name: name.trim(),
      type,
      boxes,
      healthStatus: 'good',
      sensorIds: [],
      notes: '',
    });
    setName('');
    setShowAdd(false);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Hives"
        subtitle={`${visibleHives.length} hive${visibleHives.length !== 1 ? 's' : ''}`}
        action={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600"
            title="Add hive"
          >
            <Plus size={22} />
          </button>
        }
      />

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hive name"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm"
            />
            <select
              value={apiaryId}
              onChange={(e) => setApiaryId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none"
            >
              {apiaries.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as HiveType)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none"
            >
              {Object.values(HIVE_TYPES).map((def) => (
                <option key={def.type} value={def.type}>{def.label}</option>
              ))}
            </select>
            <p className="text-xs text-stone-400 dark:text-stone-500">{HIVE_TYPES[type].description}</p>
            <button
              onClick={handleAdd}
              disabled={!name.trim() || !apiaryId}
              className="w-full py-2.5 rounded-xl bg-honey-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-honey-600"
            >
              Add Hive
            </button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {visibleHives.map((h) => {
          const apiary = apiaries.find((a) => a.id === h.apiaryId);
          const meta = HEALTH_META[h.healthStatus];
          const hasSensor = h.sensorIds && h.sensorIds.length > 0;
          return (
            <Card key={h.id} onClick={() => {}} pad={false}>
              <Link to={`/hives/${h.id}`} className="flex items-center gap-3 p-4">
                <div className="w-11 h-11 rounded-xl bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-400 flex items-center justify-center shrink-0">
                  <Boxes size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{h.name}</div>
                  <div className="text-xs text-stone-400 dark:text-stone-500 truncate flex items-center gap-1.5">
                    {apiary?.name ?? '—'}
                    <span className="text-stone-300 dark:text-stone-600">·</span>
                    {HIVE_TYPES[h.type].label}
                    {hasSensor && <Thermometer size={11} className="text-sky-500" />}
                    {h.location && <MapPin size={11} className="text-honey-500" />}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                <ChevronRight size={18} className="text-stone-300 dark:text-stone-600" />
              </Link>
            </Card>
          );
        })}
        {visibleHives.length === 0 && !showAdd && (
          <p className="text-center text-sm text-stone-400 dark:text-stone-500 py-12">No hives yet. Tap + to add one.</p>
        )}
      </div>
    </div>
  );
}