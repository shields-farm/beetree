/**
 * API base URL + auth token for the BeeTree Express backend.
 *
 * In development, Vite proxies /api/* to the Express backend (localhost:3001),
 * so we use an empty base — requests are same-origin, avoiding mixed-content
 * errors when the frontend is served over HTTPS via Tailscale.
 *
 * The API requires a bearer token (BEETREE_API_KEY). Set it in localStorage
 * under 'beetree-api-key'. On first load with no key, the app will prompt.
 */

function getApiBase(): string {
  try {
    const override = localStorage.getItem('beetree-api-base');
    if (override) return override;
  } catch { /* localStorage not available */ }
  return '';
}

export const API_BASE = getApiBase();

/** Get the API key from localStorage (set by Settings page or on first load). */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem('beetree-api-key');
  } catch { return null; }
}

/** Set the API key in localStorage. */
export function setApiKey(key: string): void {
  try {
    localStorage.setItem('beetree-api-key', key);
  } catch { /* ignore */ }
}

/** Check if an API key is configured. */
export function hasApiKey(): boolean {
  return !!getApiKey();
}

/**
 * Authenticated fetch wrapper — adds Authorization header automatically.
 * Use this for all API calls instead of raw fetch().
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const key = getApiKey();
  const headers = new Headers(init?.headers);
  if (key) {
    headers.set('Authorization', 'Bearer ' + key);
  }
  return fetch(input, { ...init, headers });
}