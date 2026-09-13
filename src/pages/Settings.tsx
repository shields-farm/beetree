import { useState } from 'react';
import { Database, RotateCcw, Trash2, Download, Upload, Hexagon, Info, Sun, Moon, Monitor, Key, Check, ShieldCheck, AlertCircle, Loader2, Bug } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { setApiKey as saveApiKey, hasApiKey, API_BASE } from '../lib/apiBase';
import {
  PEST_PRODUCTS, CATEGORY_META, getPestPrefs, setPestPrefs,
  type PestProduct,
} from '../lib/pestPrefs';

export function Settings() {
  const { apiaries, hives, inspections, sensors, tasks, resetToSeed, clearAll } = useStore();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [msg, setMsg] = useState('');

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  const exportData = () => {
    const data = JSON.stringify({ apiaries, hives, inspections, sensors, tasks }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beetree-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Exported data as JSON.');
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" subtitle="Manage your BeeTree data" />

      {/* Theme selector */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          {resolvedTheme === 'dark' ? <Moon size={16} className="text-honey-600 dark:text-honey-400" /> : <Sun size={16} className="text-honey-600 dark:text-honey-400" />}
          Appearance
        </h3>
        <div className="flex gap-2">
          {([
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Monitor },
          ] as { value: Theme; label: string; icon: typeof Sun }[]).map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={
                  'flex-1 py-3 rounded-xl text-sm font-semibold flex flex-col items-center gap-1.5 transition-colors ' +
                  (active
                    ? 'bg-honey-500 text-white shadow-sm'
                    : 'border border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800')
                }
              >
                <Icon size={20} />
                {opt.label}
              </button>
            );
          })}
        </div>
        {theme === 'system' && (
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-2 text-center">
            Currently using <span className="font-medium text-stone-600 dark:text-stone-300">{resolvedTheme}</span> mode (following your system)
          </p>
        )}
      </Card>

      {/* App info */}
      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-honey-500 flex items-center justify-center shadow-sm">
            <Hexagon size={26} className="text-white" fill="white" />
          </div>
          <div>
            <div className="font-bold text-stone-800 dark:text-stone-100">BeeTree</div>
            <div className="text-xs text-stone-400 dark:text-stone-500">v0.2 · Beekeeping management</div>
          </div>
        </div>
      </Card>

      {/* Data stats */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <Database size={16} className="text-honey-600 dark:text-honey-400" /> Data Overview
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Apiaries" value={apiaries.length} />
          <Stat label="Hives" value={hives.length} />
          <Stat label="Inspections" value={inspections.length} />
          <Stat label="Sensors" value={sensors.length} />
          <Stat label="Tasks" value={tasks.length} />
          <Stat label="Storage" value="SQLite" small />
        </div>
      </Card>

      {/* API Key / Security */}
      <ApiKeyCard />

      {/* Pest Control Preferences */}
      <PestPrefsCard />

      {/* Data management */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3">Data Management</h3>
        <div className="space-y-2">
          <button
            onClick={exportData}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-stone-200 dark:border-stone-800 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
          >
            <Download size={18} className="text-honey-600 dark:text-honey-400" />
            Export data (JSON)
          </button>
          <label className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-stone-200 dark:border-stone-800 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 cursor-pointer">
            <Upload size={18} className="text-honey-600 dark:text-honey-400" />
            Import data (JSON)
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const parsed = JSON.parse(String(reader.result));
                    localStorage.setItem('beelog-state-v1', JSON.stringify(parsed));
                    flash('Imported. Reloading…');
                    setTimeout(() => window.location.reload(), 800);
                  } catch {
                    flash('Invalid file.');
                  }
                };
                reader.readAsText(file);
              }}
            />
          </label>
          <button
            onClick={() => {
              if (confirm('Reset all data back to seed sample data? This will overwrite your current data.')) {
                resetToSeed();
                flash('Reset to seed data.');
              }
            }}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-amber-200 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:border-amber-800"
          >
            <RotateCcw size={18} className="text-amber-600 dark:text-amber-400" />
            Reset to sample data
          </button>
          <button
            onClick={() => {
              if (confirm('Delete ALL data? This cannot be undone.')) {
                clearAll();
                flash('All data cleared.');
              }
            }}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-red-200 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:border-red-800"
          >
            <Trash2 size={18} className="text-red-500 dark:text-red-400" />
            Clear all data
          </button>
        </div>
      </Card>

      {/* About */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2 flex items-center gap-2">
          <Info size={16} className="text-stone-400 dark:text-stone-500" /> About BeeTree
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
          BeeTree is a mobile-first beekeeping management app with BroodMinder sensor integration
          and a UGA Master Craftsman Beekeeper AI assistant.
        </p>
      </Card>

      {msg && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 animate-fade-in">
          {msg}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div className="bg-stone-50 dark:bg-stone-950 rounded-xl px-3 py-2.5">
      <div className={`font-bold text-stone-800 dark:text-stone-100 ${small ? 'text-sm' : 'text-xl'}`}>{value}</div>
      <div className="text-[10px] text-stone-400 dark:text-stone-500">{label}</div>
    </div>
  );
}

function ApiKeyCard() {
  const [keyInput, setKeyInput] = useState('');
  const [saved, setSaved] = useState(hasApiKey());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const handleSave = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;

    // Test the key against the server before saving
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch(API_BASE + '/api/apiaries', {
        headers: { Authorization: 'Bearer ' + trimmed },
      });
      if (resp.ok) {
        saveApiKey(trimmed);
        setSaved(true);
        setKeyInput('');
        setShowKey(false);
        setTestResult('ok');
      } else {
        setTestResult('fail');
      }
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  // Auto-detect key from server (only works when accessing from same machine)
  const handleAutoDetect = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch(API_BASE + '/api/key');
      if (resp.ok) {
        const data = await resp.json();
        if (data.key) {
          // Test the detected key
          const testResp = await fetch(API_BASE + '/api/apiaries', {
            headers: { Authorization: 'Bearer ' + data.key },
          });
          if (testResp.ok) {
            saveApiKey(data.key);
            setSaved(true);
            setTestResult('ok');
          } else {
            setTestResult('fail');
          }
        } else {
          setTestResult('fail');
        }
      } else {
        setTestResult('fail');
      }
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const handleClear = () => {
    saveApiKey('');
    setSaved(false);
    setTestResult(null);
  };

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-green-600 dark:text-green-400" /> API Security
      </h3>

      {saved ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
            <Check size={16} />
            <span>API key configured — API calls are authenticated.</span>
          </div>
          <button
            onClick={handleClear}
            className="text-xs text-red-500 dark:text-red-400 hover:text-red-600"
          >
            Remove API key
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 rounded-lg p-2.5">
            <Key size={14} className="shrink-0 mt-0.5" />
            <span>No API key set. The server requires authentication. Enter the key shown in the server console to enable data sync.</span>
          </div>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setTestResult(null); }}
              placeholder="Paste API key here"
              className="flex-1 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm font-mono"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="px-3 rounded-xl border border-stone-200 dark:border-stone-800 text-xs text-stone-500"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {testResult === 'fail' && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-2.5">
              <AlertCircle size={14} className="shrink-0" />
              <span>Key rejected by server. Make sure you copied the full key from the server console.</span>
            </div>
          )}
          {testResult === 'ok' && (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-lg p-2.5">
              <Check size={14} className="shrink-0" />
              <span>Key verified — API calls are now authenticated.</span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={!keyInput.trim() || testing}
            className="w-full py-2.5 rounded-xl bg-honey-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {testing ? (
              <><Loader2 size={16} className="animate-spin" /> Testing…</>
            ) : (
              'Save API Key'
            )}
          </button>
          <button
            onClick={handleAutoDetect}
            disabled={testing}
            className="w-full py-2 rounded-xl border border-stone-200 dark:border-stone-800 text-xs text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Auto-detect key (same machine only)'}
          </button>
        </div>
      )}
    </Card>
  );
}

// ─── Pest Control Preferences Card ──────────────────────────────────────────
function PestPrefsCard() {
  const [prefs, setPrefs] = useState(getPestPrefs());
  const [msg, setMsg] = useState('');

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const handleToggle = (productId: string) => {
    const updated = { ...prefs, [productId]: !prefs[productId] };
    setPestPrefs(updated);
    setPrefs(updated);
    flash(`${PEST_PRODUCTS.find(p => p.id === productId)?.name ?? productId} ${updated[productId] ? 'enabled' : 'disabled'}`);
  };

  // Group products by category
  const categories = Object.keys(CATEGORY_META) as PestProduct['category'][];

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-1 flex items-center gap-2">
        <Bug size={16} className="text-honey-600 dark:text-honey-400" /> Pest Control Preferences
      </h3>
      <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
        Treatment recommendations will only show products you use. Toggle what's in your kit.
      </p>

      <div className="space-y-3">
        {categories.map((cat) => {
          const products = PEST_PRODUCTS.filter((p) => p.category === cat);
          if (products.length === 0) return null;
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat}>
              <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">
                {meta.label}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {products.map((product) => {
                  const enabled = prefs[product.id] ?? false;
                  return (
                    <button
                      key={product.id}
                      onClick={() => handleToggle(product.id)}
                      className={
                        'flex items-start gap-2.5 px-3 py-2 rounded-xl border text-left transition-colors ' +
                        (enabled
                          ? 'border-honey-300 dark:border-honey-700 bg-honey-50 dark:bg-honey-950'
                          : 'border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900')
                      }
                    >
                      <div className={
                        'shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center ' +
                        (enabled ? 'bg-honey-500 border-honey-500' : 'border-stone-300 dark:border-stone-600')
                      }>
                        {enabled && <Check size={12} className="text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={'text-xs font-medium ' + (enabled ? 'text-stone-800 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400')}>
                          {product.name}
                        </div>
                        <div className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 leading-tight">
                          {product.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {msg && (
        <p className="text-xs text-green-600 dark:text-green-400 mt-2 text-center">{msg}</p>
      )}
    </Card>
  );
}