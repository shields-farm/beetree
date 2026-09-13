import { useState, useEffect } from 'react';
import { MapPin, Boxes, Bug } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Hives } from './Hives';
import { ColonyMap } from './ColonyMap';
import { HealthTrends } from './HealthTrends';
import { SwarmRisk } from './SwarmRisk';
import { Apiaries } from './Apiaries';
import { QueenTracking } from './QueenTracking';
import { Treatments } from './Treatments';
import { Pests } from './Pests';
import { PageTabs, type PageTab } from '../components/PageTabs';

type TabId = 'hives' | 'swarm' | 'queen' | 'treatments' | 'pests' | 'trends' | 'apiaries' | 'map';

const TABS: PageTab<TabId>[] = [
  { id: 'hives', label: 'Hives', icon: <Boxes size={15} /> },
  { id: 'swarm', label: 'Swarm Risk' },
  { id: 'queen', label: 'Queen' },
  { id: 'treatments', label: 'Treatments', icon: <Bug size={15} /> },
  { id: 'pests', label: 'Pests' },
  { id: 'trends', label: 'Trends' },
  { id: 'apiaries', label: 'Apiaries' },
  { id: 'map', label: 'Colony Map' },
];

const VALID_TABS = TABS.map((t) => t.id);

/** Read ?tab= from the hash so deep links and redirects land on the right tab. */
function tabFromHash(): TabId {
  try {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const t = params.get('tab') as TabId | null;
    if (t && VALID_TABS.includes(t)) return t;
  } catch { /* ignore */ }
  return 'hives';
}

const APIARY_STORAGE_KEY = 'beetree-selected-apiary';

/**
 * Hives hub.
 *
 * Queen tracking, treatments and swarm risk were standalone routes that the
 * dashboard linked to but that were never registered — /queen, /treatments and
 * /swarm all rendered an empty page. They are all "a fact about a hive", so
 * they live here now, behind the hive scoping that this hub already owns.
 */
export function HivesHub() {
  const { apiaries } = useStore();
  const [tab, setTab] = useState<TabId>(tabFromHash);

  // React to hash changes (redirects from legacy routes, back button)
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleSetTab = (t: TabId) => {
    setTab(t);
    const hash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', `${hash}?tab=${t}`);
  };

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

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 mb-3">Hives</h1>

      {/* Apiary chip picker — only scopes the tabs that are per-hive */}
      {(tab === 'hives' || tab === 'swarm' || tab === 'queen' || tab === 'trends') && apiaries.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar pb-1">
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

      <PageTabs tabs={TABS} value={tab} onChange={handleSetTab} />

      {/* Tab content */}
      {tab === 'hives' && <Hives apiaryFilter={selectedApiaryId} />}
      {tab === 'swarm' && <SwarmRisk />}
      {tab === 'queen' && <QueenTracking />}
      {tab === 'treatments' && <Treatments />}
      {tab === 'pests' && <Pests />}
      {tab === 'trends' && <HealthTrends />}
      {tab === 'apiaries' && <Apiaries />}
      {tab === 'map' && <ColonyMap />}
    </div>
  );
}
