import { AlertTriangle, CheckCircle2, Activity, Thermometer, Battery } from 'lucide-react';
import { useAnomalies } from '../lib/useAnomalies';

// Icon + color lookup per anomaly label
const ANOMALY_ICONS: Record<string, { icon: typeof Activity; color: string }> = {
  'High temp (>99°F)': { icon: Thermometer, color: 'text-red-500' },
  'Low temp (<88°F)': { icon: Thermometer, color: 'text-blue-500' },
  'Low battery (<2.5V)': { icon: Battery, color: 'text-amber-500' },
  'Stale (>6h)': { icon: Activity, color: 'text-stone-400' },
  'Significant outliers': { icon: AlertTriangle, color: 'text-red-500' },
  'Moderate outliers': { icon: AlertTriangle, color: 'text-amber-500' },
};

/**
 * At-a-glance anomaly banner for the Sensors hub.
 *
 * The hub tab is called "Anomalies" and the badge counts what is wrong; this
 * is the summary that turns that count into "which sensors, and how".
 */
export function AnomalySummary() {
  const { total, items, allClear } = useAnomalies();

  return (
    <div className={'rounded-2xl border-2 p-4 ' + (!allClear ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950' : 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950')}>
      <div className="flex items-center gap-2">
        {!allClear ? (
          <AlertTriangle size={20} className="text-amber-500" />
        ) : (
          <CheckCircle2 size={20} className="text-green-500" />
        )}
        <span className={'font-semibold text-sm ' + (!allClear ? 'text-amber-800 dark:text-amber-200' : 'text-green-800 dark:text-green-200')}>
          {!allClear ? `${total} ${total === 1 ? 'anomaly' : 'anomalies'}` : 'All sensors normal'}
        </span>
      </div>
      {items.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {items.map((s, i) => {
            const meta = ANOMALY_ICONS[s.label] ?? { icon: AlertTriangle, color: 'text-amber-500' };
            const Icon = meta.icon;
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Icon size={14} className={meta.color + ' shrink-0'} />
                <span className="font-medium text-stone-700 dark:text-stone-200">{s.count}</span>
                <span className="text-stone-500 dark:text-stone-400">{s.label}</span>
                {s.detail && <span className="text-stone-400 dark:text-stone-500 truncate">— {s.detail}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
