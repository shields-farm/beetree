import { LayoutDashboard, MapPin, Boxes, ClipboardList, Thermometer, CheckSquare, Settings as SettingsIcon, Hexagon, Camera, Bug, Wind, CalendarClock, PenLine, TrendingUp, Pill, Flower2, AudioLines, Crown, GitCompare, Layers } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/apiaries', label: 'Apiaries', icon: MapPin },
  { to: '/hives', label: 'Hives', icon: Boxes },
  { to: '/inspections', label: 'Inspections', icon: ClipboardList },
  { to: '/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/quick-inspect', label: 'Quick Inspect', icon: PenLine },
  { to: '/frame-analysis', label: 'AI Frame Analysis', icon: Camera },
  { to: '/varroa', label: 'Varroa Counter', icon: Bug },
  { to: '/swarm', label: 'Swarm Risk', icon: Wind },
  { to: '/trends', label: 'Health Trends', icon: TrendingUp },
  { to: '/treatments', label: 'Treatments', icon: Pill },
  { to: '/forage', label: 'Forage', icon: Flower2 },
  { to: '/acoustics', label: 'Acoustics', icon: AudioLines },
  { to: '/queen', label: 'Queen Track', icon: Crown },
  { to: '/outliers', label: 'Outliers', icon: GitCompare },
  { to: '/colony-map', label: 'Colony Map', icon: Layers },
  { to: '/sensors', label: 'Sensors', icon: Thermometer },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-stone-200 bg-white h-screen sticky top-0">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-stone-100">
        <div className="w-9 h-9 rounded-xl bg-honey-500 flex items-center justify-center shadow-sm">
          <Hexagon size={20} className="text-white" fill="white" />
        </div>
        <div>
          <div className="font-bold text-stone-800 leading-tight">BeeTree</div>
          <div className="text-[10px] text-stone-400 leading-tight">Beekeeping Manager</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-honey-50 text-honey-700'
                    : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                }`
              }
            >
              <Icon size={20} strokeWidth={2} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-stone-100">
        <p className="text-[10px] text-stone-300">BeeTree v0.1 · local-only</p>
      </div>
    </aside>
  );
}