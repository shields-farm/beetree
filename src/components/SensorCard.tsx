import { Thermometer, Droplets, BatteryFull, Signal, Clock, MapPin, Layers, AlertTriangle } from 'lucide-react';
import type { Sensor } from '../types';
import { freshness } from '../lib/format';

interface SensorCardProps {
  sensor: Sensor;
  onClick?: () => void;
  compact?: boolean;
}

export function SensorCard({ sensor, onClick, compact }: SensorCardProps) {
  const r = sensor.latestReading;
  const batteryPct = r ? Math.max(0, Math.min(100, ((r.batteryVoltage - 2.2) / (3.0 - 2.2)) * 100)) : 0;

  // Hive association + box placement
  const hiveName = (sensor as any).hiveName as string | undefined;
  const boxNumber = (sensor as any).boxNumber as number | undefined;
  const placement = sensor.position ? sensor.position.charAt(0).toUpperCase() + sensor.position.slice(1) : '';
  const hasHive = hiveName || sensor.hiveId;

  // Staleness — a reading from weeks ago was previously footed with a bare
  // relative timestamp inside a section captioned "Live Sensors".
  const fresh = freshness(r?.timestamp);
  const stale = fresh?.stale ?? false;

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-stone-900 rounded-xl border shadow-card ${onClick ? 'cursor-pointer active:scale-[0.99] hover:shadow-card-hover' : ''} transition-all ${
        stale ? 'border-amber-200 dark:border-amber-900' : 'border-stone-100 dark:border-stone-800'
      }`}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Thermometer size={15} className={`shrink-0 ${stale ? 'text-amber-500' : 'text-sky-600'}`} />
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-100 truncate">{sensor.name}</span>
            </div>
            <div className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
              {sensor.deviceId} · {sensor.model}
            </div>
          </div>
          {r && (
            <div className="flex items-center gap-1.5 text-[10px] shrink-0">
              <BatteryFull size={14} className={batteryPct > 50 ? 'text-green-500' : batteryPct > 20 ? 'text-amber-500' : 'text-red-500 dark:text-red-400'} />
              <span className="text-stone-500 dark:text-stone-400">{r.batteryVoltage}V</span>
            </div>
          )}
        </div>

        {/* Hive association + box placement */}
        {hasHive ? (
          <div className="flex items-center gap-2 mb-2 text-[10px]">
            {hiveName && (
              <span className="flex items-center gap-0.5 bg-honey-50 dark:bg-honey-950 text-honey-700 dark:text-honey-300 px-1.5 py-0.5 rounded-md font-medium">
                <MapPin size={10} /> {hiveName}
              </span>
            )}
            {boxNumber && (
              <span className="flex items-center gap-0.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 px-1.5 py-0.5 rounded-md">
                <Layers size={10} /> Box {boxNumber}
              </span>
            )}
            {placement && (
              <span className="flex items-center gap-0.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 px-1.5 py-0.5 rounded-md">
                {placement}
              </span>
            )}
          </div>
        ) : (
          <div className="mb-2 text-[10px] text-stone-300 dark:text-stone-600 italic">Unassigned</div>
        )}

        {r ? (
          <>
            <div className={`grid grid-cols-2 gap-2 ${compact ? '' : 'mt-1'}`}>
              <div className="rounded-lg bg-orange-50 dark:bg-orange-950 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400 font-medium uppercase tracking-wide">
                  <Thermometer size={11} /> Temp
                </div>
                <div className="text-lg font-bold text-orange-700 dark:text-orange-300 leading-tight">
                  {r.temperature.toFixed(1)}°F
                </div>
              </div>
              <div className="rounded-lg bg-sky-50 dark:bg-sky-950 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 font-medium uppercase tracking-wide">
                  <Droplets size={11} /> Humidity
                </div>
                <div className="text-lg font-bold text-sky-700 dark:text-sky-300 leading-tight">{r.humidity.toFixed(0)}%</div>
              </div>
            </div>
            {!compact && (
              <div className="flex items-center justify-between mt-2 text-[10px]">
                <span className="flex items-center gap-1 text-stone-400 dark:text-stone-500">
                  <Signal size={11} /> {r.signal} dBm
                </span>
                <span
                  className={`flex items-center gap-1 ${
                    stale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-stone-400 dark:text-stone-500'
                  }`}
                  title={fresh ? `Last reading: ${fresh.absolute}` : undefined}
                >
                  {stale ? <AlertTriangle size={11} /> : <Clock size={11} />}
                  {stale ? `Stale — ${fresh?.absolute}` : fresh?.relative}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-stone-400 dark:text-stone-500 italic py-2">No reading available</p>
        )}
      </div>
    </div>
  );
}
