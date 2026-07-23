import { useState } from 'react';
import { Thermometer, Plus, X, ChevronDown } from 'lucide-react';
import { useStore } from '../store/useStore';

interface SensorPickerProps {
  hiveId: string;
  boxId: string;
  boxSensorIds: string[];
}

const POSITIONS = ['top', 'center', 'bottom', 'entrance', 'inner-cover'];

export function SensorPicker({ hiveId, boxId, boxSensorIds }: SensorPickerProps) {
  const { sensors, assignSensor } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState('');
  const [position, setPosition] = useState('bottom');

  const assigned = sensors.filter((s) => boxSensorIds.includes(s.id));
  const available = sensors.filter((s) => !s.hiveId || s.hiveId === hiveId);

  const handleAssign = () => {
    if (!selectedSensor) return;
    assignSensor(selectedSensor, hiveId, boxId, position);
    setSelectedSensor('');
    setShowAdd(false);
  };

  const handleUnassign = (sensorId: string) => {
    assignSensor(sensorId, undefined, undefined, undefined);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
          <Thermometer size={13} className="text-sky-600" /> Sensors on this box
        </span>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs text-honey-600 dark:text-honey-400 font-medium flex items-center gap-1 hover:text-honey-700"
        >
          {showAdd ? <X size={13} /> : <Plus size={13} />} {showAdd ? 'Cancel' : 'Assign'}
        </button>
      </div>

      {assigned.length === 0 && !showAdd && (
        <p className="text-xs text-stone-400 dark:text-stone-500 italic">No sensors assigned to this box.</p>
      )}

      {assigned.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5"
        >
          <div className="min-w-0">
            <div className="text-xs font-medium text-sky-900 truncate">
              {s.name} <span className="text-sky-500 font-normal">({s.deviceId})</span>
            </div>
            <div className="text-[10px] text-sky-600">
              {s.model} {s.position ? `· ${s.position}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleUnassign(s.id)}
            className="text-sky-400 hover:text-red-500 p-1"
            title="Unassign"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {showAdd && (
        <div className="p-2.5 rounded-lg bg-stone-50 dark:bg-stone-950 dark:bg-stone-800 border border-stone-200 dark:border-stone-800 dark:border-stone-700 space-y-2 animate-fade-in">
          <div>
            <label className="text-[11px] text-stone-500 dark:text-stone-400 font-medium block mb-1">Select sensor</label>
            <div className="relative">
              <select
                value={selectedSensor}
                onChange={(e) => setSelectedSensor(e.target.value)}
                className="w-full appearance-none rounded-lg border border-stone-200 dark:border-stone-800 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm dark:text-stone-100 pr-8"
              >
                <option value="">Choose a sensor…</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.deviceId} ({s.model})
                    {s.hiveId ? ' (reassign)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-stone-500 dark:text-stone-400 font-medium block mb-1">Position in box</label>
            <div className="flex gap-1.5 flex-wrap">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    position === p
                      ? 'bg-honey-500 text-white'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedSensor}
            className="w-full py-2 rounded-lg bg-honey-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-honey-600 transition-colors"
          >
            Assign sensor
          </button>
          {available.length === 0 && (
            <p className="text-[11px] text-stone-400 dark:text-stone-500 text-center">All sensors already assigned to this hive.</p>
          )}
        </div>
      )}
    </div>
  );
}