/**
 * Global chat store that lives outside React component lifecycle.
 * This allows chat requests to continue loading when the user navigates
 * away from the chat page and comes back.
 *
 * Server-backed (Sept 2026): sessions + messages persist in SQLite via
 * /api/chat/* endpoints, so history roams across devices (phone via Tailscale
 * ↔ desktop). localStorage is only used for the active-session pointer and
 * the one-time legacy-history migration. Messages are synced optimistically:
 * local echo immediately, server POST in the background.
 */

import { API_BASE, apiFetch } from './apiBase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: { name: string; args: string; result: string }[];
  followUps?: string[];
  a2uiMessages?: any[];
  sensorCards?: any[];
  pending?: boolean;
  /** The turn failed to deliver a reply — offer a one-tap retry. */
  failed?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const ACTIVE_KEY = 'beetree-chat-active';
const MIGRATED_KEY = 'beetree-chat-migrated';

type Listener = () => void;
const listeners = new Set<Listener>();

let sessions: ChatSession[] = [];
let activeSessionId: string | null = (() => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
})();
let loading = false;
let hydrated = false;

function notify() {
  listeners.forEach(l => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSessions() { return sessions; }
export function getActiveSessionId() { return activeSessionId; }
export function getLoading() { return loading; }
export function isHydrated() { return hydrated; }

export function setActiveSession(id: string) {
  activeSessionId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
  notify();
}

// ---------- hydrate from server ----------

export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    // Lane-scoped: this store drives the Buzz chat (Hermes lane) only. The Buzz Thread
    // page has its own lane; crossing them sends messages somewhere nothing answers.
    const res = await apiFetch(API_BASE + '/api/chat/sessions?lane=chat');
    if (res.ok) {
      sessions = (await res.json()) as ChatSession[];
      sessions = sessions.map(s => ({ ...s, messages: [] }));
      if (!activeSessionId || !sessions.some(s => s.id === activeSessionId)) {
        activeSessionId = sessions[0]?.id ?? null;
        if (activeSessionId) {
          try { localStorage.setItem(ACTIVE_KEY, activeSessionId); } catch { /* ignore */ }
        }
      }
      // Lazy-load messages for the active session only; others load on switch.
      if (activeSessionId) await loadMessages(activeSessionId);
      notify();
    }
  } catch { /* server unreachable — start empty, retry on next action */ }
  void migrateLegacyLocal();
}

export async function loadMessages(sessionId: string): Promise<void> {
  const sess = sessions.find(s => s.id === sessionId);
  if (!sess || sess.messages.length > 0) return;
  try {
    const res = await apiFetch(API_BASE + '/api/chat/sessions/' + sessionId + '/messages');
    if (res.ok) {
      sess.messages = (await res.json()) as ChatMessage[];
      notify();
    }
  } catch { /* ignore */ }
}

/** One-time: push legacy localStorage history to the server, then clear it. */
async function migrateLegacyLocal(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const raw = localStorage.getItem('beetree-chat-sessions');
    if (!raw) { localStorage.setItem(MIGRATED_KEY, '1'); return; }
    const legacy = JSON.parse(raw) as ChatSession[];
    const rich = [...legacy].sort((a, b) => (b.messages?.length ?? 0) - (a.messages?.length ?? 0)).slice(0, 10);
    if (rich.length === 0) { localStorage.setItem(MIGRATED_KEY, '1'); return; }
    const res = await apiFetch(API_BASE + '/api/chat/migrate-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions: rich }),
    });
    if (res.ok) {
      localStorage.setItem(MIGRATED_KEY, '1');
      localStorage.removeItem('beetree-chat-sessions');
      sessions = [];
      activeSessionId = null;
      hydrated = false;
      await hydrate();
    }
  } catch { /* migration is best-effort; retried next load until it succeeds */ }
}

// ---------- session ops (server-backed) ----------

export function newSession(welcomeMessage: ChatMessage): string {
  const tempId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: tempId,
    title: 'New Chat',
    messages: [welcomeMessage],
    createdAt: now,
    updatedAt: now,
  };
  sessions = [session, ...sessions];
  activeSessionId = tempId;
  try { localStorage.setItem(ACTIVE_KEY, tempId); } catch { /* ignore */ }
  notify();
  // Create server-side; adopt the real id when it returns.
  apiFetch(API_BASE + '/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New Chat' }),
  }).then(async res => {
    if (!res.ok) return;
    const created = await res.json();
    const createdId = created.id as string;
    // Re-point the temp session: keep local id stable in memory, remember server id for persistence.
    (session as any).serverId = createdId;
    void persistMessage(tempId, createdId, welcomeMessage, now);
    notify();
  }).catch(() => { /* offline — local-only for now */ });
  return tempId;
}

export function deleteSession(id: string) {
  sessions = sessions.filter(s => s.id !== id);
  if (activeSessionId === id) {
    activeSessionId = sessions[0]?.id ?? null;
    if (activeSessionId) { try { localStorage.setItem(ACTIVE_KEY, activeSessionId); } catch { /* ignore */ } }
  }
  notify();
  const target = sessions.find(s => s.id === activeSessionId);
  if (target && target.messages.length === 0) void loadMessages(target.id);
  apiFetch(API_BASE + '/api/chat/sessions/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: true }),
  }).catch(() => { /* ignore */ });
}

/** Resolve the durable server id for a (possibly still temp-id) session. */
function serverIdFor(id: string): string | null {
  const sess = sessions.find(s => s.id === id);
  if (!sess) return null;
  return (sess as any).serverId ?? (/^chat-/.test(id) ? id : null);
}

/** Persist a single message to the server (fire-and-forget). */
async function persistMessage(sessionLocalId: string, knownServerId: string | null, m: ChatMessage, ts: string): Promise<void> {
  let serverId = knownServerId ?? serverIdFor(sessionLocalId);
  // Wait briefly for session creation to round-trip if it hasn't yet.
  for (let i = 0; !serverId && i < 10; i++) {
    await new Promise(r => setTimeout(r, 300));
    serverId = serverIdFor(sessionLocalId);
  }
  if (!serverId) return; // offline — message stays local only
  apiFetch(API_BASE + '/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: serverId,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      followUps: m.followUps,
      thinking: m.thinking,
      timestamp: ts,
    }),
  }).catch(() => { /* ignore */ });
}

export function updateSession(id: string, updater: (s: ChatSession) => ChatSession) {
  sessions = sessions.map(s => s.id === id ? updater(s) : s);
  notify();
}

export function buildMessagesPayload(
  context: string,
  currentMessages: ChatMessage[],
  userContent: string,
) {
  return [
    { role: 'system', content: context },
    ...currentMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ];
}

/**
 * Send a chat message. This runs OUTSIDE React's lifecycle — it continues
 * even if the ChatPage component unmounts. Results are stored in the session
 * and listeners are notified. Every message is persisted server-side.
 *
 * No client-side abort timeout: a Buzz answer that calls tools takes 60-100s
 * end to end (up to 5 tool rounds, each a separate LLM call plus local
 * dispatch), so a 120s abort raced that work — the request kept running
 * server-side and the answer was logged, but the UI showed "that took too
 * long" and the reply never arrived. The server's SSE keep-alive pings keep
 * the connection warm through Tailscale, so waiting is safe.
 */
export async function sendChat(
  sessionId: string,
  context: string,
  currentMessages: ChatMessage[],
  userText: string,
): Promise<void> {
  const now = new Date().toISOString();
  const userMsg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: userText.trim(),
    timestamp: now,
  };

  updateSession(sessionId, s => ({
    ...s,
    title: s.messages.length <= 1 ? userText.trim().slice(0, 40) : s.title,
    messages: [...s.messages, userMsg],
    updatedAt: now,
  }));
  void persistMessage(sessionId, null, userMsg, now);

  loading = true;
  notify();
  try {
    await requestReply(sessionId, context, currentMessages, userText);
  } finally {
    loading = false;
    notify();
  }
}

/**
 * Re-ask the last question after a failed turn.
 *
 * The failed turn's bubble is dropped from the history *and* from the UI, so
 * the retry is a clean re-ask rather than a nested "retry" message the model
 * has to interpret — and Mark is left with one question and one answer, not a
 * stack of error bubbles.
 */
export async function retryLast(
  sessionId: string,
  context: string,
): Promise<void> {
  if (loading) return;
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const userMsg = [...session.messages].reverse().find(m => m.role === 'user');
  if (!userMsg) return;

  // History as it stood before the question — the question is appended by
  // buildMessagesPayload inside requestReply.
  const userIndex = session.messages.findIndex(m => m.id === userMsg.id);
  const history = session.messages
    .slice(0, userIndex)
    .filter(m => !m.failed)
    .map(m => ({ role: m.role, content: m.content })) as ChatMessage[];

  // Drop the failed bubble but keep the question on screen. Sending the
  // history from before the question is what avoids duplicating it: the
  // payload appends userText, so the model sees it once while the UI still
  // shows the single bubble the retry is replacing.
  updateSession(sessionId, s => ({
    ...s,
    messages: s.messages.filter(m => !m.failed),
  }));

  loading = true;
  notify();
  try {
    await requestReply(sessionId, context, history, userMsg.content);
  } finally {
    loading = false;
    notify();
  }
}

/**
 * Build the conversation payload and ask Buzz, storing the reply in the session.
 *
 * Shared by the first attempt and by `retryLast`. `currentMessages` is the
 * history to send — the caller decides whether that includes the failed turn.
 */
async function requestReply(
  sessionId: string,
  context: string,
  currentMessages: ChatMessage[],
  userText: string,
): Promise<void> {
  try {
    const payload = buildMessagesPayload(context, currentMessages, userText);
    const response = await apiFetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payload, stream: true }),
    });

    if (!response.ok) throw new Error(`BeeTree API returned ${response.status}`);

    // Handle SSE streaming response
    const contentType = response.headers.get('Content-Type') || '';
    let data: any;
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const lines = text.split('\n');
      const dataLine = lines.find(l => l.startsWith('data: '));
      if (!dataLine) throw new Error('No data in SSE response');
      data = JSON.parse(dataLine.slice(6));
      // The server delivers errors on the same channel as answers. Without
      // this the UI showed "No response from AI." and the real reason — an
      // upstream 503, a missing tool — was swallowed.
      if (data.error) throw new Error(String(data.error));
    } else {
      data = await response.json();
      if (data.error) throw new Error(String(data.error));
    }
    const rawContent = data.content ?? 'No response from AI.';
    const cleanContent = rawContent
      .replace(/FOLLOW_UP:\s*\[[\s\S]*?\]/, '').trim()
      .replace(/A2UI:\s*\[[\s\S]*?\]/, '').trim();
    const followUps = (data.followUps as string[]) || [];
    const a2uiMessages = (data.a2uiMessages as any[]) || [];
    const sensorCards = (data.sensorCards as any[]) || undefined;
    const toolCalls = data.toolCalls;
    const thinking = data.thinking;
    const assistantTs = new Date().toISOString();

    updateSession(sessionId, s => ({
      ...s,
      messages: [...s.messages, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: cleanContent,
        timestamp: assistantTs,
        thinking, toolCalls,
        followUps: followUps.length > 0 ? followUps : undefined,
        a2uiMessages: a2uiMessages.length > 0 ? a2uiMessages : undefined,
        sensorCards,
      }],
      updatedAt: assistantTs,
    }));
    void persistMessage(sessionId, null, {
      role: 'assistant',
      content: cleanContent,
      thinking, toolCalls,
      followUps: followUps.length > 0 ? followUps : undefined,
    } as ChatMessage, assistantTs);
  } catch (err) {
    // A failure here means the reply never reached the UI. Say so once, in
    // plain language, and mark the turn as retryable rather than only
    // advertising the error text — the answer exists (or existed) server-side
    // and Mark's question is still the last thing he said.
    const errTs = new Date().toISOString();
    updateSession(sessionId, s => ({
      ...s,
      messages: [...s.messages, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: `I didn't get an answer back — ${err instanceof Error ? err.message : 'unknown error'}. Tap retry and I'll pick it up from here.`,
        timestamp: errTs,
        failed: true,
      }],
    }));
  } finally {
    loading = false;
    notify();
  }
}