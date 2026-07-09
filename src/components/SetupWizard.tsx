import { useState, useEffect } from 'react';
import { Hexagon, MapPin, Boxes, Thermometer, KeyRound, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { setApiKey, getApiKey, API_BASE, apiFetch } from '../lib/apiBase';

interface SetupStatus {
  hasData: boolean;
  apiaryCount: number;
  hiveCount: number;
  sensorCount: number;
}

type Step = 'welcome' | 'apikey' | 'apiary' | 'hive' | 'sensor' | 'done';

export function SetupWizard() {
  const [step, setStep] = useState<Step>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // API key step
  const [keyInput, setKeyInput] = useState('');

  // Apiary step
  const [apiaryName, setApiaryName] = useState('');
  const [apiaryAddress, setApiaryAddress] = useState('');
  const [apiaryLat, setApiaryLat] = useState('');
  const [apiaryLng, setApiaryLng] = useState('');

  // Hive step
  const [hiveName, setHiveName] = useState('');
  const [hiveType, setHiveType] = useState<'langstroth' | 'long' | 'nuc' | 'apimaye'>('langstroth');

  // Sensor step
  const [sensorDeviceId, setSensorDeviceId] = useState('');
  const [sensorName, setSensorName] = useState('');
  const [sensorModel, setSensorModel] = useState('BroodMinder TH');
  const [hasSensor, setHasSensor] = useState(false);

  // Check if user already has a key in localStorage
  useEffect(() => {
    const existingKey = getApiKey();
    if (existingKey) {
      setKeyInput(existingKey);
      // Check if DB has data
      checkSetupStatus(existingKey);
    }
  }, []);

  async function checkSetupStatus(key: string) {
    try {
      const resp = await fetch(API_BASE + '/api/setup/status', {
        headers: { 'Authorization': 'Bearer ' + key },
      });
      if (resp.ok) {
        const status: SetupStatus = await resp.json();
        if (status.hasData) {
          // Already set up — reload the app
          window.location.reload();
          return;
        }
        // Key works, DB is empty — go to apiary step
        setStep('apiary');
      } else if (resp.status === 401 || resp.status === 403) {
        // Key invalid — stay on apikey step
        setStep('apikey');
      }
    } catch {
      // Server might not be reachable
      setStep('apikey');
    }
  }

  async function validateKey() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(API_BASE + '/api/setup/status', {
        headers: { 'Authorization': 'Bearer ' + keyInput.trim() },
      });
      if (resp.ok) {
        setApiKey(keyInput.trim());
        const status: SetupStatus = await resp.json();
        if (status.hasData) {
          window.location.reload();
        } else {
          setStep('apiary');
        }
      } else if (resp.status === 401 || resp.status === 403) {
        setError('Invalid API key. Check the key and try again.');
      } else {
        setError('Server returned ' + resp.status + '. Try again.');
      }
    } catch (e) {
      setError('Cannot reach BeeTree server. Make sure it is running.');
    } finally {
      setLoading(false);
    }
  }

  async function createApiary() {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/apiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: apiaryName,
          address: apiaryAddress || undefined,
          location: apiaryLat || apiaryLng ? {
            lat: apiaryLat ? parseFloat(apiaryLat) : undefined,
            lng: apiaryLng ? parseFloat(apiaryLng) : undefined,
          } : undefined,
        }),
      });
      if (resp.ok) {
        setStep('hive');
      } else {
        const body = await resp.json().catch(() => ({}));
        setError(body.error || 'Failed to create apiary');
      }
    } catch {
      setError('Network error creating apiary');
    } finally {
      setLoading(false);
    }
  }

  async function createHive() {
    setLoading(true);
    setError(null);
    try {
      // Get first apiary
      const listResp = await apiFetch(API_BASE + '/api/apiaries');
      const apiaries = await listResp.json();
      if (!apiaries || apiaries.length === 0) {
        setError('No apiary found. Go back and create one first.');
        setStep('apiary');
        return;
      }
      const apiaryId = apiaries[0].id;

      const resp = await apiFetch(API_BASE + '/api/hives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiaryId,
          name: hiveName,
          type: hiveType,
          healthStatus: 'good',
        }),
      });
      if (resp.ok) {
        setStep('sensor');
      } else {
        const body = await resp.json().catch(() => ({}));
        setError(body.error || 'Failed to create hive');
      }
    } catch {
      setError('Network error creating hive');
    } finally {
      setLoading(false);
    }
  }

  async function createSensor() {
    setLoading(true);
    setError(null);
    try {
      // Get first hive
      const listResp = await apiFetch(API_BASE + '/api/hives');
      const hives = await listResp.json();
      if (!hives || hives.length === 0) {
        setError('No hive found.');
        return;
      }
      const hiveId = hives[0].id;

      const resp = await apiFetch(API_BASE + '/api/sensors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: sensorDeviceId,
          name: sensorName,
          model: sensorModel,
          hiveId,
        }),
      });
      if (resp.ok) {
        setStep('done');
      } else {
        const body = await resp.json().catch(() => ({}));
        setError(body.error || 'Failed to register sensor');
      }
    } catch {
      setError('Network error registering sensor');
    } finally {
      setLoading(false);
    }
  }

  function finish() {
    window.location.reload();
  }

  const steps: { id: Step; label: string; icon: typeof Hexagon }[] = [
    { id: 'welcome', label: 'Welcome', icon: Hexagon },
    { id: 'apikey', label: 'API Key', icon: KeyRound },
    { id: 'apiary', label: 'Apiary', icon: MapPin },
    { id: 'hive', label: 'Hive', icon: Boxes },
    { id: 'sensor', label: 'Sensor', icon: Thermometer },
  ];
  const currentStepIdx = steps.findIndex(s => s.id === step);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Hexagon size={32} className="text-honey-500" />
          <span className="text-xl font-bold text-stone-800 dark:text-stone-100">BeeTree</span>
        </div>

        {/* Progress bar */}
        {step !== 'welcome' && step !== 'done' && (
          <div className="flex items-center gap-1 mb-6">
            {steps.slice(1).map((s, i) => {
              const idx = i + 1;
              const active = idx === currentStepIdx;
              const done = idx < currentStepIdx;
              return (
                <div key={s.id} className="flex items-center gap-1 flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    done ? 'bg-honey-500 text-white' :
                    active ? 'bg-honey-100 dark:bg-honey-900 text-honey-700 dark:text-honey-300 ring-2 ring-honey-400' :
                    'bg-stone-200 dark:bg-stone-800 text-stone-400'
                  }`}>
                    {done ? <CheckCircle2 size={14} /> : idx}
                  </div>
                  {i < steps.length - 2 && <div className={`flex-1 h-0.5 ${done ? 'bg-honey-400' : 'bg-stone-200 dark:bg-stone-800'}`} />}
                </div>
              );
            })}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* WELCOME */}
        {step === 'welcome' && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-stone-800 dark:text-stone-100 mb-3">Welcome to BeeTree</h1>
            <p className="text-stone-500 dark:text-stone-400 mb-6 leading-relaxed">
              Integrated beekeeping management — track hives, sensors, inspections, and get AI-powered recommendations.
            </p>
            <div className="space-y-2 text-left text-sm text-stone-500 dark:text-stone-400 mb-6">
              <div className="flex items-center gap-2"><MapPin size={16} className="text-honey-500" /> Set up your apiary</div>
              <div className="flex items-center gap-2"><Boxes size={16} className="text-honey-500" /> Add your first hive</div>
              <div className="flex items-center gap-2"><Thermometer size={16} className="text-honey-500" /> Connect a sensor</div>
            </div>
            <button
              onClick={() => setStep(getApiKey() ? 'apiary' : 'apikey')}
              className="w-full py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 transition-colors flex items-center justify-center gap-2"
            >
              Get Started <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* API KEY */}
        {step === 'apikey' && (
          <div>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-2">Enter your API key</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
              BeeTree requires an API key to access your data. Find it in the server console output or on the server machine at <code className="text-xs bg-stone-100 dark:bg-stone-800 px-1 rounded">localhost:3001/api/key</code>.
            </p>
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && keyInput.trim() && validateKey()}
              placeholder="Paste your API key here"
              className="w-full px-4 py-3 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm font-mono focus:ring-2 focus:ring-honey-400 focus:border-transparent"
              autoFocus
            />
            <button
              onClick={validateKey}
              disabled={!keyInput.trim() || loading}
              className="w-full mt-4 py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Validate Key <ChevronRight size={18} /></>}
            </button>
          </div>
        )}

        {/* APIARY */}
        {step === 'apiary' && (
          <div>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-2">Create your apiary</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">An apiary is the location where you keep your hives.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Name *</label>
                <input
                  type="text"
                  value={apiaryName}
                  onChange={(e) => setApiaryName(e.target.value)}
                  placeholder="e.g. the home apiary"
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Address (optional)</label>
                <input
                  type="text"
                  value={apiaryAddress}
                  onChange={(e) => setApiaryAddress(e.target.value)}
                  placeholder="e.g. 1111 the home apiary Rd"
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Latitude (optional)</label>
                  <input
                    type="text"
                    value={apiaryLat}
                    onChange={(e) => setApiaryLat(e.target.value)}
                    placeholder="33.5"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Longitude (optional)</label>
                  <input
                    type="text"
                    value={apiaryLng}
                    onChange={(e) => setApiaryLng(e.target.value)}
                    placeholder="-83.5"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={createApiary}
              disabled={!apiaryName.trim() || loading}
              className="w-full mt-4 py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Create Apiary <ChevronRight size={18} /></>}
            </button>
          </div>
        )}

        {/* HIVE */}
        {step === 'hive' && (
          <div>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-2">Add your first hive</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">You can add more hives later.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Hive name *</label>
                <input
                  type="text"
                  value={hiveName}
                  onChange={(e) => setHiveName(e.target.value)}
                  placeholder="e.g. Hive 1"
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Hive type</label>
                <select
                  value={hiveType}
                  onChange={(e) => setHiveType(e.target.value as typeof hiveType)}
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                >
                  <option value="langstroth">Langstroth</option>
                  <option value="long">Long Hive</option>
                  <option value="nuc">Nuc</option>
                  <option value="apimaye">Apimaye</option>
                </select>
              </div>
            </div>
            <button
              onClick={createHive}
              disabled={!hiveName.trim() || loading}
              className="w-full mt-4 py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Add Hive <ChevronRight size={18} /></>}
            </button>
          </div>
        )}

        {/* SENSOR */}
        {step === 'sensor' && (
          <div>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-2">Connect a sensor</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
              Optional — you can skip this and add sensors later. BroodMinder sensors report temperature, humidity, and battery.
            </p>
            {!hasSensor ? (
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('done')}
                  className="flex-1 py-3 px-4 rounded-xl border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 font-medium hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => setHasSensor(true)}
                  className="flex-1 py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 transition-colors"
                >
                  Add Sensor
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Device ID *</label>
                  <input
                    type="text"
                    value={sensorDeviceId}
                    onChange={(e) => setSensorDeviceId(e.target.value)}
                    placeholder="e.g. 6a:bb:1c:2d:3e:4f"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Name *</label>
                  <input
                    type="text"
                    value={sensorName}
                    onChange={(e) => setSensorName(e.target.value)}
                    placeholder="e.g. BroodMinder TH #1"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Model</label>
                  <select
                    value={sensorModel}
                    onChange={(e) => setSensorModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 text-sm focus:ring-2 focus:ring-honey-400 focus:border-transparent"
                  >
                    <option value="BroodMinder TH">BroodMinder TH</option>
                    <option value="BroodMinder T2">BroodMinder T2</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <button
                  onClick={createSensor}
                  disabled={!sensorDeviceId.trim() || !sensorName.trim() || loading}
                  className="w-full py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Register Sensor <ChevronRight size={18} /></>}
                </button>
              </div>
            )}
          </div>
        )}

        {/* DONE */}
        {step === 'done' && (
          <div className="text-center">
            <CheckCircle2 size={48} className="text-honey-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-stone-800 dark:text-stone-100 mb-2">You're all set!</h2>
            <p className="text-stone-500 dark:text-stone-400 mb-6">BeeTree is ready to use. You can add more apiaries, hives, and sensors anytime.</p>
            <button
              onClick={finish}
              className="w-full py-3 px-4 rounded-xl bg-honey-500 text-white font-medium hover:bg-honey-600 transition-colors"
            >
              Enter BeeTree
            </button>
          </div>
        )}
      </div>
    </div>
  );
}