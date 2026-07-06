import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Hives } from './Hives';
import { ColonyMap } from './ColonyMap';
import { HealthTrends } from './HealthTrends';
import { SwarmRisk } from './SwarmRisk';
import { Apiaries } from './Apiaries';

type TabId = 'hives' | 'swarm' | 'apiaries' | 'colony-map' | 'trends';

const TABS: { id: TabId; label: string }[] = [
  { id: 'hives', label: 'Hives' },
  { id: 'swarm', label: 'Swarm Risk' },
  { id: 'apiaries', label: 'Apiaries' },
  { id: 'colony-map', label: 'Colony Map' },
  { id: 'trends', label: 'Health Trends' },
];

const APIARY_STORAGE_KEY = 'beetree-selected-apiary';

export function HivesHub() {
  const { apiaries } = useStore();
  const [tab, setTab] = useState<TabId>('hives');

  // Selected apiary — persists in localStorage, defaults to first
  const [selectedApiaryId, setSelectedApiaryId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(APIARY_STORAGE_KEY);
      if (saved && apiaries.some((a) => a.id === saved)) return saved;
    } catch { /* ignore */ }
    return apiaries[0]?.id ?? '';
  });

  const switchApiary = (id: string) => {
    setSelectedApiaryId(id);
    try { localStorage.setItem(APIARY_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const selectedApiary = apiaries.find((a) => a.id === selectedApiaryId);

  return (
    <div className="animate-fade-in">
      {/* Apiary chip picker — only show on hives and swarm tabs */}
      {(tab === 'hives' || tab === 'swarm') && apiaries.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <MapPin size={14} className="text-stone-400 shrink-0" />
          <button
            onClick={() => switchApiary('')}
            className={
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
              (selectedApiaryId === ''
                ? 'bg-honey-500 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
            }
          >
            All
          </button>
          {apiaries.map((a) => (
            <button
              key={a.id}
              onClick={() => switchApiary(a.id)}
              className={
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
                (a.id === selectedApiaryId
                  ? 'bg-honey-500 text-white'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
              }
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

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
      {tab === 'hives' && <Hives apiaryFilter={selectedApiaryId} />}
      {tab === 'swarm' && <SwarmRisk />}
      {tab === 'apiaries' && <Apiaries />}
      {tab === 'colony-map' && <ColonyMap />}
      {tab === 'trends' && <HealthTrends />}
    </div>
  );
}