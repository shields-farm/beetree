import { useState } from 'react';
import { Database, RotateCcw, Trash2, Download, Upload, Hexagon, Info } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

export function Settings() {
  const { apiaries, hives, inspections, sensors, tasks, resetToSeed, clearAll } = useStore();
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

      {/* App info */}
      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-honey-500 flex items-center justify-center shadow-sm">
            <Hexagon size={26} className="text-white" fill="white" />
          </div>
          <div>
            <div className="font-bold text-stone-800">BeeLog</div>
            <div className="text-xs text-stone-400">v0.1 · Beekeeping management</div>
          </div>
        </div>
      </Card>

      {/* Data stats */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Database size={16} className="text-honey-600" /> Data Overview
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Apiaries" value={apiaries.length} />
          <Stat label="Hives" value={hives.length} />
          <Stat label="Inspections" value={inspections.length} />
          <Stat label="Sensors" value={sensors.length} />
          <Stat label="Tasks" value={tasks.length} />
          <Stat label="Storage" value="localStorage" small />
        </div>
      </Card>

      {/* Data management */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 mb-3">Data Management</h3>
        <div className="space-y-2">
          <button
            onClick={exportData}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-stone-200 text-sm text-stone-700 hover:bg-stone-50"
          >
            <Download size={18} className="text-honey-600" />
            Export data (JSON)
          </button>
          <label className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-stone-200 text-sm text-stone-700 hover:bg-stone-50 cursor-pointer">
            <Upload size={18} className="text-honey-600" />
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
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-amber-200 text-sm text-amber-700 hover:bg-amber-50"
          >
            <RotateCcw size={18} className="text-amber-600" />
            Reset to sample data
          </button>
          <button
            onClick={() => {
              if (confirm('Delete ALL data? This cannot be undone.')) {
                clearAll();
                flash('All data cleared.');
              }
            }}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-red-200 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={18} className="text-red-500" />
            Clear all data
          </button>
        </div>
      </Card>

      {/* About */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 mb-2 flex items-center gap-2">
          <Info size={16} className="text-stone-400" /> About BeeTree
        </h3>
        <p className="text-xs text-stone-500 leading-relaxed">
          BeeTree is a mobile-first beekeeping management app inspired by APiLOG, enhanced with
          BroodMinder sensor integration and a GBA Master Craftsman Beekeeper AI assistant.
          Supported hive types: Langstroth 10/8-frame, Horizontal Long Hive, 5-frame Nuc, 7-frame Apimaye, Apimaye Queen Castle.
        </p>
        <p className="text-[11px] text-stone-400 mt-2">
          Supported hive types: Langstroth 10/8-frame, Horizontal Long Hive, 5-frame Nuc, 7-frame Apimaye, Apimaye Queen Castle.
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
    <div className="bg-stone-50 rounded-xl px-3 py-2.5">
      <div className={`font-bold text-stone-800 ${small ? 'text-sm' : 'text-xl'}`}>{value}</div>
      <div className="text-[10px] text-stone-400">{label}</div>
    </div>
  );
}