import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

/**
 * InstallPrompt — shows a banner when the browser fires `beforeinstallprompt`.
 *
 * The component captures the event, displays a non-intrusive banner at the
 * bottom of the screen, and calls `prompt()` when the user taps "Install".
 * If the user dismisses it, it won't show again for 7 days.
 *
 * On iOS Safari (which doesn't fire beforeinstallprompt), we show a brief
 * "Add to Home Screen" hint banner instead.
 */

const DISMISS_KEY = 'beetree-install-dismissed';
const DISMISS_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

function isDismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    const days = (Date.now() - parseInt(ts, 10)) / (1000 * 60 * 60 * 24);
    return days < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  } catch {
    // ignore
  }
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Already installed (running standalone) → no prompt needed
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    // Check for iOS Safari (no beforeinstallprompt event)
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    if (iOS && isSafari) {
      setIsIOS(true);
      if (!isDismissedRecently()) {
        setVisible(true);
      }
    }

    const onBeforeInstall = (e: Event) => {
      // Prevent the mini-infobar from showing on mobile
      e.preventDefault();
      if (isDismissedRecently()) return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Don't render if already installed or not visible
  if (installed || !visible) return null;

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'dismissed') {
        dismiss();
      }
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    dismiss();
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
      <div className="mx-auto max-w-md pointer-events-auto rounded-2xl bg-white dark:bg-stone-800 shadow-lg border border-stone-200 dark:border-stone-700 p-4 flex items-center gap-3 animate-slide-up">
        <div className="w-10 h-10 rounded-xl bg-honey-500 flex items-center justify-center shrink-0">
          <Download size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">
            Install BeeTree
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400">
            {isIOS
              ? 'Tap Share → Add to Home Screen for offline access'
              : 'Add to your home screen for quick offline access'}
          </div>
        </div>
        {!isIOS && (
          <button
            onClick={handleInstall}
            className="shrink-0 px-4 py-2 rounded-lg bg-honey-500 hover:bg-honey-600 text-white text-sm font-semibold transition-colors"
          >
            Install
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
