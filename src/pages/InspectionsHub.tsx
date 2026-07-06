import { useState } from 'react';
import { InspectionList } from './InspectionList';
import { QuickInspect } from './QuickInspect';
import { FrameAnalysisPage } from './FrameAnalysis';
import { SmartSchedule } from './SmartSchedule';
import { QueenTracking } from './QueenTracking';

type TabKey = 'history' | 'quick' | 'ai' | 'schedule' | 'queen';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'history', label: 'History' },
  { key: 'quick', label: 'Quick Inspect' },
  { key: 'ai', label: 'AI Photo' },
  { key: 'queen', label: 'Queen Track' },
  { key: 'schedule', label: 'Schedule' },
];

export function InspectionsHub() {
  const [tab, setTab] = useState<TabKey>('history');

  return (
    <div className="animate-fade-in">
      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 no-scrollbar">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                'shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-colors ' +
                (active
                  ? 'bg-honey-500 text-white shadow-sm'
                  : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700')
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="pt-2">
        {tab === 'history' && <InspectionList />}
        {tab === 'quick' && <QuickInspect />}
        {tab === 'ai' && <FrameAnalysisPage />}
        {tab === 'queen' && <QueenTracking />}
        {tab === 'schedule' && <SmartSchedule />}
      </div>
    </div>
  );
}

export default InspectionsHub;