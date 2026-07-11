import { useSyncExternalStore } from 'react';
import {
  subscribe, getSessions, getActiveSessionId, getLoading,
  type ChatSession, type ChatMessage,
} from './chatStore';

export function useChatStore() {
  const sessions = useSyncExternalStore(subscribe, getSessions, getSessions);
  const activeSessionId = useSyncExternalStore(subscribe, getActiveSessionId, getActiveSessionId);
  const loading = useSyncExternalStore(subscribe, getLoading, getLoading);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];

  return { sessions, activeSessionId, activeSession, messages, loading };
}

export type { ChatSession, ChatMessage };
