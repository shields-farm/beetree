import { Boxes, ClipboardList, Thermometer, CheckSquare, Camera } from 'lucide-react';
import { NavLink } from 'react-router-dom';

/** Custom icon: a 10-frame deep hive box (side view with vertical frame lines) */
function HiveBoxIcon({ size = 22, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Outer box — deep rectangle */}
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      {/* 10 vertical frame lines (spaced across the box) */}
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

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: HiveBoxIcon, end: true },
  { to: '/inspections', label: 'Inspect', icon: ClipboardList },
  { to: '/frame-analysis', label: 'AI', icon: Camera },
  { to: '/hives', label: 'Hives', icon: Boxes },
  { to: '/sensors', label: 'Sensors', icon: Thermometer },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
];

export function BottomNav() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-t border-stone-200 dark:border-stone-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-honey-600' : 'text-stone-400 dark:text-stone-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}