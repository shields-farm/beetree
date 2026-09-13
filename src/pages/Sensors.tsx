import { Link, useNavigate } from 'react-router-dom';
import { Plus, Thermometer, Trash2, Bluetooth, Pencil, X, ChevronRight, RefreshCw, CheckCircle2, Wifi } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { SensorCard } from '../components/SensorCard';
import { API_BASE, apiFetch } from '../lib/apiBase';
import { SensorTrendChart } from '../components/SensorTrendChart';

interface DiscoveredSensor {
  deviceId: string;
  formattedId: string;
  friendlyName: string;
  temperature: number | null;
  humidity: number | null;
  batteryVoltage: number | null;
  batteryPct: number | null;
  signal: number | null;
  online: boolean;
}

export function Sensors() {
  const { sensors, hives, addSensor, deleteSensor, refreshSensorReadings } = useStore();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('TH-Pro');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredSensor[]>([]);
  const [alreadyRegistered, setAlreadyRegistered] = useState<DiscoveredSensor[]>([]);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/sensors/discover');
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Discovery failed' }));
        throw new Error(err.error);
      }
      const data = await resp.json();
      setDiscovered(data.discovered || []);
      setAlreadyRegistered(data.registered || []);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Auto-discover when opening the add panel
  useEffect(() => {
    if (showAdd && discovered.length === 0 && !discovering && !discoverError) {
      discover();
    }
  }, [showAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = () => {
    if (!deviceId.trim()) return;
    // Prevent duplicate registration
    const normalized = deviceId.trim().toUpperCase().replace(/:/g, '');
    const dupe = sensors.some(s => s.deviceId.toUpperCase().replace(/:/g, '') === normalized);
    if (dupe) {
      alert('This sensor is already registered.');
      return;
    }
    addSensor({
      deviceId: deviceId.trim(),
      name: name.trim() || `BroodMinder-${deviceId.trim().slice(-2)}`,
      model,
    });
    setDeviceId('');
    setName('');
    setShowAdd(false);
  };

  const handleAddDiscovered = (d: DiscoveredSensor) => {
    // Prevent duplicate registration
    const normalized = d.deviceId.toUpperCase().replace(/:/g, '');
    const dupe = sensors.some(s => s.deviceId.toUpperCase().replace(/:/g, '') === normalized);
    if (dupe) return; // already registered, ignore
    const detectedModel = 'TH-Pro';
    // Include live readings from HA so the card shows data immediately
    const latestReading = (d.temperature !== null || d.humidity !== null || d.batteryPct !== null) ? {
      temperature: d.temperature,
      humidity: d.humidity,
      batteryVoltage: d.batteryVoltage,
      batteryPct: d.batteryPct,
      signal: d.signal,
      timestamp: new Date().toISOString(),
    } : undefined;
    addSensor({
      deviceId: d.formattedId,
      name: d.friendlyName,
      model: detectedModel,
      latestReading,
    } as any);
    // Remove from discovered list
    setDiscovered(prev => prev.filter(x => x.deviceId !== d.deviceId));
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Sensors"
        subtitle={`${sensors.length} BroodMinder sensor${sensors.length !== 1 ? 's' : ''}`}
        action={
          <button
            onClick={refreshSensorReadings}
            className="w-10 h-10 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center dark:bg-sky-950 dark:text-sky-400"
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
            <div className="flex items-center gap-2">
              <button onClick={discover} disabled={discovering} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300" title="Re-scan">
                <RefreshCw size={16} className={discovering ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => setShowAdd(false)} className="text-stone-400 dark:text-stone-500"><X size={18} /></button>
            </div>
          </div>

          {/* Discovered sensors */}
          {discovering && (
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 py-3">
              <RefreshCw size={14} className="animate-spin" />
              Scanning for BroodMinder sensors via Home Assistant...
            </div>
          )}

          {discoverError && (
            <div className="text-xs text-amber-600 dark:text-amber-400 mb-3 p-2 bg-amber-50 dark:bg-amber-950 rounded-lg">
              Couldn't auto-discover: {discoverError}. You can still register manually below.
            </div>
          )}

          {discovered.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 mb-2">
                <Wifi size={12} />
                BROADCASTING — TAP TO ADD
              </div>
              <div className="space-y-2">
                {discovered.map((d) => (
                  <button
                    key={d.deviceId}
                    onClick={() => handleAddDiscovered(d)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors text-left"
                  >
                    <Bluetooth size={18} className={d.online ? 'text-sky-500' : 'text-stone-400'} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-800 dark:text-stone-100">{d.friendlyName}</div>
                      <div className="text-[10px] text-stone-400 dark:text-stone-500 font-mono">{d.formattedId}</div>
                    </div>
                    <div className="flex gap-3 text-[10px] text-stone-500 dark:text-stone-400">
                      {d.temperature !== null && <span>{d.temperature.toFixed(1)}°F</span>}
                      {d.batteryPct !== null && <span>{d.batteryPct.toFixed(0)}%</span>}
                      {d.signal !== null && <span>{d.signal}dBm</span>}
                    </div>
                    <Plus size={16} className="text-sky-500 shrink-0" />
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2">
                These sensors are broadcasting BLE advertisements detected by your Pi Zero W via Home Assistant. Tap to register with auto-detected settings.
              </p>
            </div>
          )}

          {alreadyRegistered.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 mb-2">
                <CheckCircle2 size={12} className="text-green-500" />
                ALREADY REGISTERED
              </div>
              <div className="space-y-1.5">
                {alreadyRegistered.map((d) => (
                  <div key={d.deviceId} className="flex items-center gap-3 p-2 rounded-lg bg-stone-50 dark:bg-stone-900">
                    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                    <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{d.friendlyName}</span>
                    <span className="text-[10px] text-stone-400 font-mono ml-auto">{d.formattedId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual registration fallback */}
          <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
            <div className="text-[11px] font-medium text-stone-400 dark:text-stone-500 mb-2">MANUAL ENTRY</div>
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
          </div>
        </Card>
      )}

      <button
        onClick={() => setShowAdd(!showAdd)}
        className="w-full mb-4 py-2.5 rounded-xl border-2 border-dashed border-sky-200 text-sky-600 text-sm font-medium hover:border-sky-400 flex items-center justify-center gap-1.5 dark:text-sky-400 dark:border-sky-800"
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
              <div key={s.id} className="relative group">
                <SensorCard sensor={s} onClick={() => navigate(`/sensors/${s.id}`)} />
                {hive && (
                  <Link
                    to={`/hives/${hive.id}`}
                    className="absolute top-2 right-2 text-[10px] bg-honey-50 dark:bg-honey-950 text-honey-700 dark:text-honey-300 px-2 py-0.5 rounded-full"
                  >
                    {hive.name}
                  </Link>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete ${s.name}?`)) {
                      deleteSensor(s.id);
                    }
                  }}
                  className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete sensor"
                >
                  <Trash2 size={14} />
                </button>
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
        <Link to="/sensors" className="text-sky-600 text-sm underline mt-2 inline-block dark:text-sky-400">Back to sensors</Link>
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
              className="w-full py-2 rounded-xl border border-red-200 text-red-600 dark:text-red-400 text-sm flex items-center justify-center gap-1.5 dark:border-red-800"
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
          <div>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) assignSensor(sensor.id, e.target.value, undefined, undefined);
              }}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none bg-white dark:bg-stone-900"
            >
              <option value="">Select a hive to assign…</option>
              {hives.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
        )}
        {sensor.position && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Position: {sensor.position}</p>}
      </Card>

      {/* Latest reading */}
      {r && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Latest Reading</h3>
            <button onClick={refreshSensorReadings} className="text-xs text-sky-600 font-medium dark:text-sky-400">Refresh</button>
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
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">Temperature & Humidity Trend</h3>
        <SensorTrendChart sensorId={sensor.id} />
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