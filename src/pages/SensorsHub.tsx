import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Activity, Thermometer, Droplet, Battery } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Sensors } from './Sensors';
import { OutlierDetection } from './OutlierDetection';
import { AcousticAnalysis } from './AcousticAnalysis';
import { API_BASE, apiFetch } from '../lib/apiBase';

type TabId = 'anomalies' | 'readings' | 'acoustics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'readings', label: 'Readings' },
  { id: 'acoustics', label: 'Acoustics' },
];

// ─── Anomaly summary ──────────────────────────────────────────────────────────
interface OutlierEntry {
  hiveId: string;
  hiveName: string;
  reason: string;
  severity: 'minor' | 'moderate' | 'significant';
  detail: string;
}
interface OutlierReport {
  apiaryId: string;
  apiaryName: string;
  outliers: OutlierEntry[];
}

function AnomalySummary() {
  const { sensors } = useStore();
  const [outlierReports, setOutlierReports] = useState<OutlierReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(API_BASE + '/api/outlier');
        if (resp.ok && !cancelled) setOutlierReports(await resp.json());
      } catch { /* server not running */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Sensor-based anomalies
  const sensorsWithReadings = sensors.filter((s) => s.latestReading);
  const highTemp = sensorsWithReadings.filter((s) => s.latestReading!.temperature > 99);
  const lowTemp = sensorsWithReadings.filter((s) => s.latestReading!.temperature > 0 && s.latestReading!.temperature < 88);
  const lowBattery = sensorsWithReadings.filter((s) => s.latestReading!.batteryVoltage > 0 && s.latestReading!.batteryVoltage < 2.5);
  const staleSensors = sensorsWithReadings.filter((s) => {
    if (!s.latestReading!.timestamp) return false;
    const hours = (Date.now() - new Date(s.latestReading!.timestamp).getTime()) / (60 * 60 * 1000);
    return hours > 6;
  });

  // Outlier-based anomalies (from server)
  const allOutliers = outlierReports.flatMap((r) => r.outliers);
  const significantOutliers = allOutliers.filter((o) => o.severity === 'significant');
  const moderateOutliers = allOutliers.filter((o) => o.severity === 'moderate');

  const totalAnomalies = highTemp.length + lowTemp.length + lowBattery.length + staleSensors.length + allOutliers.length;

  const summaryItems = [
    { count: highTemp.length, label: 'High temp (>99°F)', icon: Thermometer, color: 'text-red-500', detail: highTemp.map((s) => s.name).join(', ') },
    { count: lowTemp.length, label: 'Low temp (<88°F)', icon: Thermometer, color: 'text-blue-500', detail: lowTemp.map((s) => s.name).join(', ') },
    { count: lowBattery.length, label: 'Low battery (<2.5V)', icon: Battery, color: 'text-amber-500', detail: lowBattery.map((s) => s.name).join(', ') },
    { count: staleSensors.length, label: 'Stale (>6h)', icon: Activity, color: 'text-stone-400', detail: staleSensors.map((s) => s.name).join(', ') },
    { count: significantOutliers.length, label: 'Significant outliers', icon: AlertTriangle, color: 'text-red-500', detail: significantOutliers.map((o) => o.hiveName).join(', ') },
    { count: moderateOutliers.length, label: 'Moderate outliers', icon: AlertTriangle, color: 'text-amber-500', detail: moderateOutliers.map((o) => o.hiveName).join(', ') },
  ].filter((s) => s.count > 0);

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className={'rounded-2xl border-2 p-4 ' + (totalAnomalies > 0 ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950' : 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950')}>
        <div className="flex items-center gap-2">
          {totalAnomalies > 0 ? (
            <AlertTriangle size={20} className="text-amber-500" />
          ) : (
            <CheckCircle2 size={20} className="text-green-500" />
          )}
          <span className={'font-semibold text-sm ' + (totalAnomalies > 0 ? 'text-amber-800 dark:text-amber-200' : 'text-green-800 dark:text-green-200')}>
            {totalAnomalies > 0 ? `${totalAnomalies} anomaly${totalAnomalies !== 1 ? 'ies' : 'y'} detected` : 'All sensors normal'}
          </span>
        </div>
        {summaryItems.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {summaryItems.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <s.icon size={14} className={s.color + ' shrink-0'} />
                <span className="font-medium text-stone-700 dark:text-stone-200">{s.count}</span>
                <span className="text-stone-500 dark:text-stone-400">{s.label}</span>
                {s.detail && <span className="text-stone-400 dark:text-stone-500 truncate">— {s.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full outlier detection page */}
      <OutlierDetection />
    </div>
  );
}

export function SensorsHub() {
  const [tab, setTab] = useState<TabId>('anomalies');

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
      {tab === 'anomalies' && <AnomalySummary />}
      {tab === 'readings' && <Sensors />}
      {tab === 'acoustics' && <AcousticAnalysis />}
    </div>
  );
}