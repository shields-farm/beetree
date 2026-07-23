import { Link } from 'react-router-dom';
import { AlertCircle, KeyRound } from 'lucide-react';

/**
 * Shared error display for pages.
 * Detects 401/403 auth errors and shows a link to Settings instead of raw text.
 */
export function ErrorCard({ error }: { error: string | null }) {
  if (!error) return null;

  const isAuthError = /40[13]/.test(error);

  if (isAuthError) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
        <KeyRound size={24} className="mx-auto text-amber-500 mb-3" />
        <p className="font-semibold text-amber-800 dark:text-amber-200">Authentication required</p>
        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1 mb-4">
          Set your API key in Settings to load data from the server.
        </p>
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
        >
          <KeyRound size={16} /> Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm text-red-700 dark:text-red-300">Error</p>
          <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
        </div>
      </div>
    </div>
  );
}