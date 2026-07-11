import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { InstallPrompt } from './components/InstallPrompt'

const __cb = "1783768153";
if (typeof window !== 'undefined') (window as any).__cb = __cb;

// ─── Register Service Worker for offline support ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Check for updates on each load
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available — activate immediately
                newWorker.postMessage('SKIP_WAITING');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <InstallPrompt />
  </StrictMode>,
)
