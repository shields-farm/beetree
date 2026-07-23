import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ChevronRight, X } from 'lucide-react';
import { hasApiKey, AUTH_ERROR_EVENT } from '../lib/apiBase';

/**
 * Global banner shown when no API key is configured or when the server
 * returns 401/403. Renders above all page content via Layout.
 */
export function ApiKeyBanner() {
  const [noKey, setNoKey] = useState(!hasApiKey());
  const [authError, setAuthError] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Re-check on mount (e.g. after navigating back from Settings)
    setNoKey(!hasApiKey());
  }, []);

  useEffect(() => {
    const handler = () => {
      setAuthError(true);
      setDismissed(false);
    };
    window.addEventListener(AUTH_ERROR_EVENT, handler);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handler);
  }, []);

  // Re-check key when window regains focus (user may have set it in another tab)
  useEffect(() => {
    const onFocus = () => {
      setNoKey(!hasApiKey());
      if (hasApiKey()) {
        setAuthError(false);
        setDismissed(false);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const show = (!dismissed && (noKey || authError));
  if (!show) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl p-3 pl-4">
        <KeyRound size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <Link to="/settings" className="flex-1 min-w-0 flex items-center gap-1 group">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {noKey ? 'API key required' : 'Authentication failed'}
            </div>
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {noKey
                ? 'Set your API key in Settings to load data.'
                : 'Your API key was rejected. Update it in Settings.'}
            </div>
          </div>
          <ChevronRight size={16} className="text-amber-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 shrink-0"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}