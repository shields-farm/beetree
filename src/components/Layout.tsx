import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hexagon, Settings as SettingsIcon } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-stone-50">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header
          className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-100 flex items-center justify-between px-4 py-2.5"
          style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}
        >
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-honey-500 flex items-center justify-center">
              <Hexagon size={16} className="text-white" fill="white" />
            </div>
            <span className="font-bold text-stone-800">BeeLog</span>
          </Link>
          <Link to="/settings" className="p-1.5 text-stone-400 hover:text-stone-600">
            <SettingsIcon size={20} />
          </Link>
        </header>

        <main
          className="flex-1 w-full max-w-3xl mx-auto px-4 py-4 sm:px-6 lg:px-8 pb-28 lg:pb-10"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4 gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-stone-800 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}