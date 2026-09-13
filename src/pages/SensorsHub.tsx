import { useState } from 'react';
import { Activity, Waves } from 'lucide-react';
import { Sensors } from './Sensors';
import { OutlierDetection } from './OutlierDetection';
import { AcousticAnalysis } from './AcousticAnalysis';
import { PageTabs, type PageTab } from '../components/PageTabs';
import { AnomalySummary } from '../components/AnomalySummary';
import { useAnomalies } from '../lib/useAnomalies';

type TabId = 'anomalies' | 'readings' | 'acoustics';

const VALID_TABS: TabId[] = ['anomalies', 'readings', 'acoustics'];

function tabFromHash(): TabId {
  try {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const t = params.get('tab') as TabId | null;
    if (t && VALID_TABS.includes(t)) return t;
  } catch { /* ignore */ }
  return 'anomalies';
}

export function SensorsHub() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const anomalies = useAnomalies();

  const handleSetTab = (t: TabId) => {
    setTab(t);
    const hash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', `${hash}?tab=${t}`);
  };

  const TABS: PageTab<TabId>[] = [
    { id: 'anomalies' as const, label: 'Anomalies', icon: <Activity size={15} />, badge: anomalies.total },
    { id: 'readings' as const, label: 'Readings' },
    { id: 'acoustics' as const, label: 'Acoustics', icon: <Waves size={15} /> },
  ];

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 mb-3">Sensors</h1>

      <PageTabs tabs={TABS} value={tab} onChange={handleSetTab} />

      {tab === 'anomalies' && (
        <div className="space-y-4">
          <AnomalySummary />
          <OutlierDetection />
        </div>
      )}
      {tab === 'readings' && <Sensors />}
      {tab === 'acoustics' && <AcousticAnalysis />}
    </div>
  );
}
