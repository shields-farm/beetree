import { useState } from 'react';
import { Hives } from './Hives';
import { ColonyMap } from './ColonyMap';
import { HealthTrends } from './HealthTrends';
import { SwarmRisk } from './SwarmRisk';

type TabId = 'hives' | 'colony-map' | 'trends' | 'swarm';

const TABS: { id: TabId; label: string }[] = [
  { id: 'hives', label: 'All Hives' },
  { id: 'swarm', label: 'Swarm Risk' },
  { id: 'colony-map', label: 'Colony Map' },
  { id: 'trends', label: 'Health Trends' },
];

export function HivesHub() {
  const [tab, setTab] = useState<TabId>('hives');

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
      {tab === 'hives' && <Hives />}
      {tab === 'swarm' && <SwarmRisk />}
      {tab === 'colony-map' && <ColonyMap />}
      {tab === 'trends' && <HealthTrends />}
    </div>
  );
}