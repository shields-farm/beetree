import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PageTab<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface PageTabsProps<T extends string> {
  tabs: PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Optional trailing node rendered inside the scroll row */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Horizontal pill tab row with real overflow affordance.
 *
 * Long tab rows used to be clipped at the viewport edge with no cue that more
 * existed — it read as a layout bug rather than a scroll. This measures the
 * scroller and renders edge fades plus a chevron whenever there is content
 * off-screen, and keeps the active tab scrolled into view.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
  className = '',
}: PageTabsProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({
      left: el.scrollLeft > 4,
      right: max > 4 && el.scrollLeft < max - 4,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure]);

  // Keep the active tab visible when it changes (e.g. deep-linked tab)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    measure();
  }, [value, measure]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className={`relative mb-4 ${className}`}>
      <div
        ref={scrollerRef}
        className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-px-5"
      >
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              data-active={active ? 'true' : undefined}
              onClick={() => onChange(t.id)}
              className={
                'shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ' +
                (active
                  ? 'bg-honey-500 text-white shadow-sm'
                  : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700')
              }
            >
              {t.icon}
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="ml-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
        {trailing}
      </div>

      {/* Right edge fade + nudge */}
      {overflow.right && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-stone-50 dark:from-stone-950 to-transparent" />
          <button
            type="button"
            aria-label="More tabs"
            onClick={() => nudge(1)}
            className="absolute top-1/2 -translate-y-1/2 -right-1 w-7 h-7 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-sm flex items-center justify-center text-stone-500 dark:text-stone-400"
          >
            <ChevronRight size={15} />
          </button>
        </>
      )}

      {/* Left edge fade + nudge */}
      {overflow.left && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-stone-50 dark:from-stone-950 to-transparent" />
          <button
            type="button"
            aria-label="Previous tabs"
            onClick={() => nudge(-1)}
            className="absolute top-1/2 -translate-y-1/2 -left-1 w-7 h-7 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-sm flex items-center justify-center text-stone-500 dark:text-stone-400"
          >
            <ChevronLeft size={15} />
          </button>
        </>
      )}
    </div>
  );
}
