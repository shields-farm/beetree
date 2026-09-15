import { useState } from 'react';
import { Boxes, ClipboardList, Thermometer, CheckSquare, MoreHorizontal, X, Globe, Cpu, Activity, Settings as SettingsIcon, MessageCircle, RefreshCw, Network } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store/useStore';

/** Custom icon: a 10-frame deep hive box (side view with vertical frame lines) */
function HiveBoxIcon({ size = 22, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
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

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; end?: boolean };

// Primary nav — always visible in the bottom bar.
// Tasks used to be absent from both navs entirely, so the highlight dropped to
// zero on /tasks even though two dashboard alerts route there.
const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: HiveBoxIcon, end: true },
  { to: '/chat', label: 'Buzz', icon: MessageCircle },
  { to: '/inspections', label: 'Inspect', icon: ClipboardList },
  { to: '/hives', label: 'Hives', icon: Boxes },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
];

// Secondary nav — behind "More". Everything here is a destination with its own
// page; hub-embedded modules (pests, acoustics, swarm, queen, treatments,
// trends) are reachable from their hub's tab row instead of from this sheet,
// which is what let this list shrink from 10 to 5.
const SECONDARY_NAV: NavItem[] = [
  { to: '/sensors', label: 'Sensors', icon: Thermometer },
  { to: '/forage', label: 'Forage', icon: Globe },
  { to: '/equipment', label: 'Equipment', icon: Boxes },
  { to: '/hardware', label: 'Hardware', icon: Cpu },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/world', label: 'World', icon: Network },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { syncFromServer } = useStore();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await syncFromServer();
    } finally {
      setRefreshing(false);
      setMoreOpen(false);
    }
  };

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More menu sheet */}
      {moreOpen && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-stone-900 rounded-t-2xl shadow-2xl border-t border-stone-200 dark:border-stone-800 animate-fade-in"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800">
            <span className="font-semibold text-stone-800 dark:text-stone-100 text-sm">More Pages</span>
            <button onClick={() => setMoreOpen(false)} className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4">
            {/* Hard refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-[10px] font-medium text-honey-600 dark:text-honey-300 bg-honey-50 dark:bg-honey-950 hover:bg-honey-100 dark:hover:bg-honey-900 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={22} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Syncing…' : 'Refresh'}
            </button>
            {SECONDARY_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-[10px] font-medium transition-colors ${
                      isActive
                        ? 'bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-300'
                        : 'text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`
                  }
                >
                  <Icon size={22} strokeWidth={2} />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>
      )}

      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-t border-stone-200 dark:border-stone-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-stretch justify-around max-w-lg mx-auto">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-medium transition-colors ${
                    isActive ? 'text-honey-600 dark:text-honey-400' : 'text-stone-400 dark:text-stone-500'
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
          {/* More button — highlighted when the current route is inside the sheet */}
          <MoreButton active={SECONDARY_NAV.some((i) => i.to === window.location.hash.replace('#', ''))} onClick={() => setMoreOpen(true)} />
        </div>
      </nav>
    </>
  );
}

function MoreButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-medium transition-colors ${
        active ? 'text-honey-600 dark:text-honey-400' : 'text-stone-400 dark:text-stone-500'
      }`}
    >
      <MoreHorizontal size={22} strokeWidth={2} />
      <span>More</span>
    </button>
  );
}
