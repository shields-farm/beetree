// @vitest-environment jsdom
/**
 * Chat send + retry behavior.
 *
 * The bug these lock down: the client aborted /api/chat at 120s. A Buzz answer
 * that calls tools genuinely takes 60-120s (measured: the May-disease question
 * that prompted this took 120.7s end to end), so the abort raced real work —
 * the reply was generated and logged server-side, but the browser showed
 * "That took too long" and the answer was lost.
 *
 * The tests drive the real module with a stubbed fetch, so they cover the
 * timeout removal, the SSE error unwrapping, and that a failed turn is
 * retryable in place.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../apiBase', () => ({
  API_BASE: '',
  apiFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

import * as chatStore from '../chatStore';

/** Answer a chat POST with a single SSE `data:` line. */
function sseResponse(payload: unknown): Response {
  return new Response('data: ' + JSON.stringify(payload) + '\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** A session that is not persisted server-side (no /api/chat/sessions POST). */
function makeSession(): string {
  return chatStore.newSession({
    id: 'welcome',
    role: 'assistant',
    content: 'Hi Mark.',
    timestamp: new Date().toISOString(),
  });
}

function currentMessages() {
  return chatStore.getSessions().find(s => s.id === chatStore.getActiveSessionId())!.messages;
}

/** Route by URL so session/message persistence calls don't shadow the chat call. */
function stubFetch(chatImpl: (init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/chat')) return chatImpl(init ?? {});
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('chat send', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for a slow reply instead of aborting it', async () => {
    stubFetch(async () => {
      await new Promise(r => setTimeout(r, 150));
      return sseResponse({ content: 'Grounded answer after a slow tool loop.' });
    });

    const id = makeSession();
    await chatStore.sendChat(id, 'ctx', [], 'Tell me about May disease');

    const messages = currentMessages();
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.content).toBe('Grounded answer after a slow tool loop.');
    expect(messages.at(-1)?.failed).toBeUndefined();
  });

  it('sends no abort signal at all', async () => {
    const mock = stubFetch(async () => sseResponse({ content: 'ok' }));

    const id = makeSession();
    await chatStore.sendChat(id, 'ctx', [], 'hello');

    const chatCall = mock.mock.calls.find(([url]) => String(url).endsWith('/api/chat'))!;
    const init = chatCall[1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });

  it('surfaces the server error instead of a generic message', async () => {
    stubFetch(async () => sseResponse({ error: 'Buzz backend unavailable after 3 attempts' }));

    const id = makeSession();
    await chatStore.sendChat(id, 'ctx', [], 'hello');

    const last = currentMessages().at(-1);
    expect(last?.failed).toBe(true);
    expect(last?.content).toContain('Buzz backend unavailable');
  });

  it('retryLast re-asks the question and clears the failed bubble', async () => {
    stubFetch(async () => sseResponse({ error: 'transient 503' }));

    const id = makeSession();
    await chatStore.sendChat(id, 'ctx', [], 'What about swarming?');
    expect(currentMessages().at(-1)?.failed).toBe(true);

    // Second attempt succeeds.
    stubFetch(async () => sseResponse({ content: 'Swarm risk is low.' }));
    await chatStore.retryLast(id, 'ctx');

    const messages = currentMessages();
    expect(messages.some(m => m.failed)).toBe(false);
    expect(messages.at(-1)?.content).toBe('Swarm risk is low.');
    // One question, one answer — the retry replaced the failed turn rather
    // than stacking a second copy of the question on top of it.
    expect(messages.filter(m => m.role === 'user' && m.content === 'What about swarming?')).toHaveLength(1);
  });
});
