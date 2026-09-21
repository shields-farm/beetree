import { Link } from 'react-router-dom';
import { Boxes, Thermometer } from 'lucide-react';
import type { Hive, HiveGroup } from '../types';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { HEALTH_META } from '../lib/health';

interface YardLayoutProps {
  group: HiveGroup;
  hives: Hive[];
}

/**
 * Top-down visual rendering of a hive group — the physical arrangement of
 * colonies in the yard. Members render left to right in `group.members` order;
 * for the Ellis Special that is hive · nuc · hive, with the nuc visually
 * smaller to read as the buffer colony between the pair.
 */
export function YardLayout({ group, hives }: YardLayoutProps) {
  const memberHives = group.members
    .map((id) => hives.find((h) => h.id === id))
    .filter((h): h is Hive => Boolean(h));

  return (
    <div className="flex items-end justify-center gap-2 sm:gap-3 py-2 overflow-x-auto">
      {memberHives.map((hive, idx) => {
        const def = HIVE_TYPES[hive.type] || HIVE_TYPES['langstroth-10'];
        const isNuc = hive.type.startsWith('nuc') || hive.type === 'queen-castle';
        const meta = HEALTH_META[hive.healthStatus];
        const hasSensor = hive.sensorIds && hive.sensorIds.length > 0;
        return (
          <div key={hive.id} className="flex flex-col items-center gap-1">
            <Link
              to={`/hives/${hive.id}`}
              className="block rounded-xl border-2 transition-transform hover:scale-105"
              style={{
                // Nuc reads as ~60% of a production hive's footprint.
                width: isNuc ? 56 : 84,
                height: isNuc ? 48 : 64,
                borderColor: isNuc ? '#f59e0b' : '#fbbf24',
                backgroundColor: '#fffbeb',
              }}
              title={`${hive.name} — ${def.label} (${meta.label})`}
            >
              <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 px-1">
                <Boxes size={isNuc ? 16 : 20} className="text-honey-700 dark:text-honey-400" />
                {hasSensor && <Thermometer size={10} className="text-sky-500" />}
              </div>
            </Link>
            <div className="text-[10px] text-stone-500 dark:text-stone-400 text-center max-w-[120px] truncate" title={hive.name}>
              {hive.name}
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
              {meta.label}
            </span>
            {/* Position marker in the arrangement */}
            <span className="text-[9px] text-stone-400 dark:text-stone-500">
              {idx + 1}/{group.members.length}
            </span>
          </div>
        );
      })}
      {memberHives.length === 0 && (
        <p className="text-xs text-stone-400 dark:text-stone-500 py-4">
          Empty group — add hives to it below.
        </p>
      )}
    </div>
  );
}