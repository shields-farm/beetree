import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ChatContextValue {
  /** Open the chat panel */
  openChat: () => void;
  /** Open the chat with a pre-filled prompt (does not auto-send) */
  openChatWithPrompt: (prompt: string) => void;
  /** Open the chat and immediately send a prompt */
  askAI: (prompt: string) => void;
  /** The current pre-filled prompt (consumed by FloatingChat) */
  pendingPrompt: string | null;
  /** Called by FloatingChat when it consumes the prompt */
  clearPendingPrompt: () => void;
  /** Page-specific quick questions for the current page */
  quickQuestions: string[];
  /** Set quick questions for the current page */
  setQuickQuestions: (questions: string[]) => void;
  /** Is the chat currently open? */
  isOpen: boolean;
  /** Set by FloatingChat */
  setIsOpen: (open: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [quickQuestions, setQuickQuestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const openChat = useCallback(() => {
    setIsOpen(true);
  }, []);

  const openChatWithPrompt = useCallback((prompt: string) => {
    setPendingPrompt(prompt);
    setIsOpen(true);
  }, []);

  const askAI = useCallback((prompt: string) => {
    setPendingPrompt(prompt);
    setIsOpen(true);
  }, []);

  const clearPendingPrompt = useCallback(() => {
    setPendingPrompt(null);
  }, []);

  return (
    <ChatContext.Provider value={{
      openChat,
      openChatWithPrompt,
      askAI,
      pendingPrompt,
      clearPendingPrompt,
      quickQuestions,
      setQuickQuestions,
      isOpen,
      setIsOpen,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

/** Inline "Ask AI" button — drops right into any page */
export function AskAIButton({ prompt, label, className }: { prompt: string; label?: string; className?: string }) {
  const { askAI } = useChat();
  return (
    <button
      onClick={() => askAI(prompt)}
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-honey-700 bg-honey-50 border border-honey-200 px-2.5 py-1.5 rounded-full hover:bg-honey-100 transition-colors ${className ?? ''}`}
    >
      <span className="text-sm">🐝</span>
      {label ?? 'Ask AI'}
    </button>
  );
}