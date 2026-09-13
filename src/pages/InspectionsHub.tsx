import { useState, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { InspectionList } from './InspectionList';
import { QuickInspect } from './QuickInspect';
import { FrameAnalysisPage } from './FrameAnalysis';
import { SmartSchedule } from './SmartSchedule';
import { OmiInspections } from './OmiInspections';
import { PageTabs, type PageTab } from '../components/PageTabs';

type TabKey = 'history' | 'quick' | 'voice' | 'ai' | 'schedule';

const TABS: PageTab<TabKey>[] = [
  { id: 'history', label: 'History' },
  { id: 'quick', label: 'Quick Inspect' },
  { id: 'voice', label: 'Voice', icon: <Mic size={15} /> },
  { id: 'ai', label: 'AI Photo' },
  { id: 'schedule', label: 'Schedule' },
];

const VALID_TABS = TABS.map((t) => t.id);

function tabFromHash(): TabKey {
  try {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const t = params.get('tab') as TabKey | null;
    if (t && VALID_TABS.includes(t)) return t;
  } catch { /* ignore */ }
  return 'history';
}

/**
 * Inspections hub.
 *
 * Queen tracking used to live here; it moved to the Hives hub where the rest
 * of the per-hive state lives. In exchange this hub picked up the Omi voice
 * capture page, which was implemented, imported nowhere and reachable from
 * nowhere at all.
 */
export function InspectionsHub() {
  const [tab, setTab] = useState<TabKey>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleSetTab = (t: TabKey) => {
    setTab(t);
    const hash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', `${hash}?tab=${t}`);
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 mb-3">Inspections</h1>

      <PageTabs tabs={TABS} value={tab} onChange={handleSetTab} />

      <div className="pt-2">
        {tab === 'history' && <InspectionList />}
        {tab === 'quick' && <QuickInspect />}
        {tab === 'voice' && <OmiInspections />}
        {tab === 'ai' && <FrameAnalysisPage />}
        {tab === 'schedule' && <SmartSchedule />}
      </div>
    </div>
  );
}

export default InspectionsHub;
