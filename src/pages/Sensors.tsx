import { Link, useNavigate } from 'react-router-dom';
import { Plus, Thermometer, Trash2, Bluetooth, Pencil, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { SensorCard } from '../components/SensorCard';

export function Sensors() {
  const { sensors, hives, addSensor, refreshSensorReadings } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('TH-Pro');

  const handleAdd = () => {
    if (!deviceId.trim()) return;
    addSensor({
      deviceId: deviceId.trim(),
      name: name.trim() || `BroodMinder-${deviceId.trim().slice(-2)}`,
      model,
    });
    setDeviceId('');
    setName('');
    setShowAdd(false);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Sensors"
        subtitle={`${sensors.length} BroodMinder sensor${sensors.length !== 1 ? 's' : ''}`}
        action={
          <button
            onClick={refreshSensorReadings}
            className="w-10 h-10 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center"
            title="Refresh readings"
          >
            <Thermometer size={20} />
          </button>
        }
      />

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Register Sensor</h3>
            <button onClick={() => setShowAdd(false)} className="text-stone-400 dark:text-stone-500"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="Device ID (e.g., 47:0B:AF)" className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none">
              <option value="TH">TH</option>
              <option value="TH-Pro">TH-Pro</option>
              <option value="TH-Pro2">TH-Pro2</option>
            </select>
            <button onClick={handleAdd} disabled={!deviceId.trim()} className="w-full py-2.5 rounded-xl bg-sky-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-sky-600">
              Register Sensor
            </button>
          </div>
        </Card>
      )}

      <button
        onClick={() => setShowAdd(!showAdd)}
        className="w-full mb-4 py-2.5 rounded-xl border-2 border-dashed border-sky-200 text-sky-600 text-sm font-medium hover:border-sky-400 flex items-center justify-center gap-1.5"
      >
        <Plus size={18} /> Register new sensor
      </button>

      {sensors.length === 0 ? (
        <p className="text-center text-sm text-stone-400 dark:text-stone-500 py-8">No sensors registered yet.</p>
      ) : (
        <div className="space-y-3">
          {sensors.map((s) => {
            const hive = hives.find((h) => h.id === s.hiveId);
            return (
              <div key={s.id} className="relative">
                <SensorCard sensor={s} onClick={() => {}} />
                {hive && (
                  <Link
                    to={`/hives/${hive.id}`}
                    className="absolute top-2 right-2 text-[10px] bg-honey-50 dark:bg-honey-950 text-honey-700 dark:text-honey-300 px-2 py-0.5 rounded-full"
                  >
                    {hive.name}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SensorDetail({ id }: { id: string }) {
  const { sensors, hives, updateSensor, deleteSensor, assignSensor, refreshSensorReadings } = useStore();
  const navigate = useNavigate();
  const sensor = sensors.find((s) => s.id === id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sensor?.name ?? '');
  const [model, setModel] = useState(sensor?.model ?? 'TH-Pro');

  if (!sensor) {
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400 dark:text-stone-500">Sensor not found.</p>
        <Link to="/sensors" className="text-sky-600 text-sm underline mt-2 inline-block">Back to sensors</Link>
      </div>
    );
  }

  const hive = hives.find((h) => h.id === sensor.hiveId);
  const r = sensor.latestReading;

  const save = () => {
    updateSensor(sensor.id, { name: name.trim() || sensor.name, model });
    setEditing(false);
  };

  return (
    <div className="animate-fade-in">
      <Link to="/sensors" className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 mb-2 inline-flex items-center gap-1">
        <ChevronRight size={14} className="rotate-180" /> Sensors
      </Link>

      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-stone-800 dark:text-stone-100 truncate">{sensor.name}</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mt-0.5">
            <Bluetooth size={14} className="text-sky-500" /> {sensor.deviceId} · {sensor.model}
          </p>
        </div>
        <button onClick={() => setEditing(!editing)} className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 flex items-center justify-center shrink-0">
          <Pencil size={16} />
        </button>
      </div>

      {editing && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none">
              <option value="TH">TH</option>
              <option value="TH-Pro">TH-Pro</option>
              <option value="TH-Pro2">TH-Pro2</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 text-sm">Cancel</button>
              <button onClick={save} className="flex-1 py-2 rounded-xl bg-sky-500 text-white text-sm font-medium">Save</button>
            </div>
            <button
              onClick={() => {
                if (confirm('Delete this sensor?')) {
                  deleteSensor(sensor.id);
                  navigate('/sensors');
                }
              }}
              className="w-full py-2 rounded-xl border border-red-200 text-red-600 dark:text-red-400 text-sm flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} /> Delete sensor
            </button>
          </div>
        </Card>
      )}

      {/* Assignment */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">Assignment</h3>
        {hive ? (
          <div className="flex items-center justify-between">
            <Link to={`/hives/${hive.id}`} className="text-sm text-honey-700 dark:text-honey-300 font-medium">{hive.name}</Link>
            <button
              onClick={() => assignSensor(sensor.id, undefined, undefined, undefined)}
              className="text-xs text-red-500 dark:text-red-400 hover:underline"
            >
              Unassign
            </button>
          </div>
        ) : (
          <p className="text-sm text-stone-400 dark:text-stone-500">Not assigned to any hive. Assign via a hive's box editor.</p>
        )}
        {sensor.position && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Position: {sensor.position}</p>}
      </Card>

      {/* Latest reading */}
      {r && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Latest Reading</h3>
            <button onClick={refreshSensorReadings} className="text-xs text-sky-600 font-medium">Refresh</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ReadingTile label="Temperature" value={`${r.temperature.toFixed(1)}°F`} color="bg-orange-50 dark:bg-orange-950 text-orange-700" />
            <ReadingTile label="Humidity" value={`${r.humidity.toFixed(0)}%`} color="bg-sky-50 text-sky-700" />
            <ReadingTile label="Battery" value={`${r.batteryVoltage}V`} color="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" />
            <ReadingTile label="Signal" value={`${r.signal} dBm`} color="bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200" />
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">Last seen: {new Date(r.timestamp).toLocaleString()}</p>
        </Card>
      )}

      {/* Mock chart placeholder using recharts would go here — kept minimal for performance */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">48h Trend (mock)</h3>
        <MockTrendChart deviceId={sensor.deviceId} />
      </Card>
    </div>
  );
}

function ReadingTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`rounded-xl ${color} px-3 py-2.5`}>
      <div className="text-[10px] uppercase tracking-wide font-medium opacity-70">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

function MockTrendChart({ deviceId }: { deviceId: string }) {
  // lightweight inline sparkline without recharts to keep bundle small on detail page
  const points: { t: number; temp: number }[] = [];
  const base = 88 + (deviceId.charCodeAt(0) % 6);
  for (let h = 48; h >= 0; h--) {
    const t = new Date(Date.now() - h * 3600 * 1000);
    const cycle = Math.sin((t.getHours() / 24) * Math.PI * 2 - Math.PI / 2);
    points.push({ t: h, temp: Number((base + cycle * 4).toFixed(1)) });
  }
  const temps = points.map((p) => p.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = max - min || 1;
  const w = 320;
  const h = 80;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.temp - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="#f59e0b" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 mt-1">
        <span>{min.toFixed(1)}°F</span>
        <span>48h ago → now</span>
        <span>{max.toFixed(1)}°F</span>
      </div>
    </div>
  );
}