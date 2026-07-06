import { useState } from 'react';
import { Sensors } from './Sensors';
import { OutlierDetection } from './OutlierDetection';
import { AcousticAnalysis } from './AcousticAnalysis';

type TabId = 'readings' | 'anomalies' | 'acoustics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'readings', label: 'Readings' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'acoustics', label: 'Acoustics' },
];

export function SensorsHub() {
  const [tab, setTab] = useState<TabId>('readings');

  return (
    <div className="animate-fade-in">
      {/* Tab bar */}
      <div className="-mx-4 px-4 mb-4 overflow-x-auto">
        <div className="inline-flex gap-2 w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-honey-500 text-white'
                  : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'readings' && <Sensors />}
      {tab === 'anomalies' && <OutlierDetection />}
      {tab === 'acoustics' && <AcousticAnalysis />}
    </div>
  );
}