import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hexagon, Settings as SettingsIcon } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { FloatingChat } from './FloatingChat';
import { ApiKeyBanner } from './ApiKeyBanner';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-stone-50 dark:bg-stone-950">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header
          className="lg:hidden sticky top-0 z-30 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-b border-stone-100 dark:border-stone-800 flex items-center justify-between px-4 py-2.5"
          style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}
        >
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-honey-500 flex items-center justify-center">
              <Hexagon size={16} className="text-white" fill="white" />
            </div>
            <span className="font-bold text-stone-800 dark:text-stone-100">BeeTree</span>
          </Link>
          <Link to="/settings" className="p-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300">
            <SettingsIcon size={20} />
          </Link>
        </header>

        <main
          className="flex-1 w-full max-w-6xl mx-auto px-4 py-4 sm:px-6 lg:px-8 pb-28 lg:pb-10"
        >
          <ApiKeyBanner />
          {children}
        </main>
      </div>
      <BottomNav />
      <FloatingChat />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4 gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}