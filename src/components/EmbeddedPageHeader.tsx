import type { ReactNode } from 'react';

/**
 * Section header for pages that render *inside* a hub tab.
 *
 * The standalone modules (Swarm Risk, Queen Tracking, Treatments, Health
 * Trends, Outlier Detection, Acoustics) were built as top-level routed pages
 * and each rendered its own PageHeader with a "← Back" button. Once embedded
 * in a hub tab there is nothing to go back to, and the <h1> stole the page
 * title from the hub it now lives in. This renders the module name as an <h2>
 * section label instead, with no back affordance.
 */
export function EmbeddedPageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100 truncate">{title}</h2>
        {subtitle && (
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
