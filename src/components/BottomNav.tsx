import { LayoutDashboard, MapPin, Boxes, ClipboardList, Thermometer, CheckSquare, Settings as SettingsIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/apiaries', label: 'Apiaries', icon: MapPin },
  { to: '/hives', label: 'Hives', icon: Boxes },
  { to: '/inspections', label: 'Inspections', icon: ClipboardList },
  { to: '/sensors', label: 'Sensors', icon: Thermometer },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function BottomNav() {
  // Show 5 main tabs; Settings accessed via a "more" or just include 6. We'll show 5 + settings squeezed.
  const items = NAV_ITEMS.slice(0, 5);
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-stone-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-honey-600' : 'text-stone-400'
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