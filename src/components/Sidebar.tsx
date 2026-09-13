import { Boxes, ClipboardList, Thermometer, CheckSquare, Settings as SettingsIcon, Hexagon, MessageCircle, Activity, Cpu, Globe } from 'lucide-react';
import { NavLink } from 'react-router-dom';

/** Custom icon: a 10-frame deep hive box (side view with vertical frame lines) */
function HiveBoxIcon({ size = 20, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="4.8" y1="5" x2="4.8" y2="19" />
      <line x1="6.6" y1="5" x2="6.6" y2="19" />
      <line x1="8.4" y1="5" x2="8.4" y2="19" />
      <line x1="10.2" y1="5" x2="10.2" y2="19" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="13.8" y1="5" x2="13.8" y2="19" />
      <line x1="15.6" y1="5" x2="15.6" y2="19" />
      <line x1="17.4" y1="5" x2="17.4" y2="19" />
      <line x1="19.2" y1="5" x2="19.2" y2="19" />
    </svg>
  );
}

/**
 * Sidebar nav.
 *
 * Was 14 flat entries — a list of pages rather than a description of the app,
 * with "Buzz" and "Buzz Thread" both present and neither distinguishable. The
 * four module pages that used to live here (Pests, and the swarm/queen/
 * treatment/trend pages that were never routed at all) are now tabs inside
 * the hub that owns them: pests live under Hives, acoustics and anomalies
 * under Sensors, scheduling under Inspections.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: HiveBoxIcon, end: true },
  { to: '/chat', label: 'Buzz', icon: MessageCircle },
  { to: '/inspections', label: 'Inspections', icon: ClipboardList },
  { to: '/hives', label: 'Hives', icon: Boxes },
  { to: '/sensors', label: 'Sensors', icon: Thermometer },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
];

const SECONDARY_ITEMS: NavItem[] = [
  { to: '/forage', label: 'Forage', icon: Globe },
  { to: '/equipment', label: 'Equipment', icon: Boxes },
  { to: '/hardware', label: 'Hardware', icon: Cpu },
  { to: '/activity', label: 'Activity', icon: Activity },
];

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; end?: boolean };

export function Sidebar() {
  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            isActive
              ? 'bg-honey-50 dark:bg-honey-950 text-honey-700 dark:text-honey-300'
              : 'text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-200'
          }`
        }
      >
        <Icon size={20} strokeWidth={2} />
        {item.label}
      </NavLink>
    );
  };

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 h-screen sticky top-0">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-stone-100 dark:border-stone-800">
        <div className="w-9 h-9 rounded-xl bg-honey-500 flex items-center justify-center shadow-sm">
          <Hexagon size={20} className="text-white" fill="white" />
        </div>
        <div>
          <div className="font-bold text-stone-800 dark:text-stone-100 leading-tight">BeeTree</div>
          <div className="text-[10px] text-stone-400 dark:text-stone-500 leading-tight">Integrated Beekeeping Management</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(renderItem)}
        <div className="pt-3 pb-1 px-3">
          <span className="text-[10px] font-bold text-stone-300 dark:text-stone-600 uppercase tracking-wider">More</span>
        </div>
        {SECONDARY_ITEMS.map(renderItem)}
      </nav>
      <div className="px-3 pb-2">
        {renderItem({ to: '/settings', label: 'Settings', icon: SettingsIcon })}
      </div>
      <div className="px-4 py-3 border-t border-stone-100 dark:border-stone-800">
        <p className="text-[10px] text-stone-300 dark:text-stone-600">BeeTree v0.2 · secure</p>
      </div>
    </aside>
  );
}
