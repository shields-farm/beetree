import { useStore } from '../store/useStore';
import { shortAge } from '../lib/format';

/**
 * Global "when did this data last arrive" indicator.
 *
 * BeeTree had no app-wide freshness signal at all — sensor cards footed
 * "about 2 months ago", the section above them said "Live Sensors", and the
 * only staleness the UI acknowledged was a per-sensor offline alert. A
 * monitoring product has to be able to say "I haven't heard from your hives
 * in seven weeks" in one place. This reads the newest timestamp in the store.
 */
export function DataFreshness() {
  const { sensors, inspections, refreshTick, syncing } = useStore();

  const stamps = [
    ...sensors.map((s) => s.latestReading?.timestamp),
    ...inspections.map((i) => i.date),
  ].filter(Boolean) as string[];

  const newest = stamps.reduce<string | null>((acc, cur) => {
    if (!acc) return cur;
    return new Date(cur).getTime() > new Date(acc).getTime() ? cur : acc;
  }, null);

  // refreshTick changes on every syncFromServer; use it to timestamp the sync
  void refreshTick;

  if (!newest && !syncing) return null;

  const label = newest ? `Data ${shortAge(newest)}` : 'No data';
  const hours = newest ? (Date.now() - new Date(newest).getTime()) / 3_600_000 : Infinity;
  const stale = hours > 6;

  return (
    <span
      className={
        'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ' +
        (stale
          ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
          : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300')
      }
      title={newest ? `Most recent reading: ${new Date(newest).toLocaleString()}` : undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {syncing ? 'Syncing…' : label}
    </span>
  );
}
