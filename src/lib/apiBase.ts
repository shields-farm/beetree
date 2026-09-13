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
 * Convert an HTTP status code to a user-friendly error message.
 * Auth errors get a clear prompt; other statuses stay descriptive.
 */
export function statusToMessage(status: number): string {
  if (status === 401 || status === 403) return 'Authentication required — set your API key in Settings.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests — slow down.';
  if (status >= 500) return 'Server error — try again later.';
  return 'HTTP ' + status;
}

/** Event dispatched on 401/403 responses so the global banner can react. */
export const AUTH_ERROR_EVENT = 'beetree-auth-error';

/**
 * Authenticated fetch wrapper — adds Authorization header automatically.
 * Use this for all API calls instead of raw fetch().
 *
 * On 401/403, dispatches a global `beetree-auth-error` event so the app
 * can show a banner prompting the user to set their API key.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const key = getApiKey();
  const headers = new Headers(init?.headers);
  if (key) {
    headers.set('Authorization', 'Bearer ' + key);
  }
  return fetch(input, { ...init, headers }).then((res) => {
    if (res.status === 401 || res.status === 403) {
      window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT));
    }
    return res;
  });
}
/** Optional display name for the beekeeper. Used in Buzz's greeting instead of
 *  a hardcoded name — this ships to other people's hives. */
const USER_NAME_KEY = 'beetree-user-name';

export function getUserName(): string {
  try { return localStorage.getItem(USER_NAME_KEY) ?? ''; } catch { return ''; }
}

export function setUserName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(USER_NAME_KEY, name.trim());
    else localStorage.removeItem(USER_NAME_KEY);
  } catch { /* ignore */ }
}
