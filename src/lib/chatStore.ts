/**
 * Global chat store that lives outside React component lifecycle.
 * This allows chat requests to continue loading when the user navigates
 * away from the chat page and comes back.
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
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const SESSIONS_KEY = 'beetree-chat-sessions';
const ACTIVE_KEY = 'beetree-chat-active';

type Listener = () => void;
const listeners = new Set<Listener>();

let sessions: ChatSession[] = loadSessions();
let activeSessionId: string | null = localStorage.getItem(ACTIVE_KEY) || null;
let loading = false;

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function persist() {
  try {
    const trimmed = sessions.slice(0, 10).map(s => ({ ...s, messages: s.messages.slice(-50) }));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch {}
  if (activeSessionId) localStorage.setItem(ACTIVE_KEY, activeSessionId);
}

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

export function setActiveSession(id: string) {
  activeSessionId = id;
  persist();
  notify();
}

export function newSession(welcomeMessage: ChatMessage): string {
  const session: ChatSession = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New Chat',
    messages: [welcomeMessage],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessions = [session, ...sessions];
  activeSessionId = session.id;
  persist();
  notify();
  return session.id;
}

export function deleteSession(id: string) {
  sessions = sessions.filter(s => s.id !== id);
  if (activeSessionId === id) {
    activeSessionId = sessions[0]?.id ?? null;
  }
  persist();
  notify();
}

export function updateSession(id: string, updater: (s: ChatSession) => ChatSession) {
  sessions = sessions.map(s => s.id === id ? updater(s) : s);
  persist();
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
 * and listeners are notified.
 */
export async function sendChat(
  sessionId: string,
  context: string,
  currentMessages: ChatMessage[],
  userText: string,
): Promise<void> {
  const userMsg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: userText.trim(),
    timestamp: new Date().toISOString(),
  };

  updateSession(sessionId, s => ({
    ...s,
    title: s.messages.length <= 1 ? userText.trim().slice(0, 40) : s.title,
    messages: [...s.messages, userMsg],
    updatedAt: new Date().toISOString(),
  }));

  loading = true;
  notify();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const payload = buildMessagesPayload(context, currentMessages, userText);
    const response = await apiFetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payload, stream: true }),
      signal: controller.signal,
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
    } else {
      data = await response.json();
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

    updateSession(sessionId, s => ({
      ...s,
      messages: [...s.messages, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: cleanContent,
        timestamp: new Date().toISOString(),
        thinking, toolCalls,
        followUps: followUps.length > 0 ? followUps : undefined,
        a2uiMessages: a2uiMessages.length > 0 ? a2uiMessages : undefined,
        sensorCards,
      }],
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    updateSession(sessionId, s => ({
      ...s,
      messages: [...s.messages, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: isAbort
          ? '⏱️ That took too long. The AI might be busy — try asking again.'
          : `Sorry, I couldn't reach the AI backend.\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }],
    }));
  } finally {
    clearTimeout(timeout);
    loading = false;
    notify();
  }
}
