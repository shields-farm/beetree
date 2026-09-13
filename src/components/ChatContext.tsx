import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';

interface ChatContextValue {
  /** Page-specific quick questions for the current page */
  quickQuestions: string[];
  /** Set quick questions for the current page */
  setQuickQuestions: (questions: string[]) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Holds only the page-scoped quick-question set now.
 *
 * This provider used to drive a FloatingChat popup: it carried `isOpen`,
 * `pendingPrompt` and an `openChat()` that set it. The popup was removed in
 * favour of the full-screen /chat route, but the context kept the whole dead
 * surface — `openChat`, `openChatWithPrompt`, `askAI`, `pendingPrompt`,
 * `clearPendingPrompt`, `isOpen` and `setIsOpen` had zero remaining consumers.
 * Buzz is a route now, not a popup, so only the question set is still live.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [quickQuestions, setQuickQuestions] = useState<string[]>([]);

  const setQuestions = useCallback((questions: string[]) => {
    setQuickQuestions(questions);
  }, []);

  return (
    <ChatContext.Provider value={{ quickQuestions, setQuickQuestions: setQuestions }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

/** Inline "Ask Buzz" button — navigates to full-screen chat with a pre-filled prompt */
export function AskAIButton({ prompt, label, className }: { prompt: string; label?: string; className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/chat', { state: { initialPrompt: prompt } })}
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-honey-700 dark:text-honey-300 bg-honey-50 dark:bg-honey-950 border border-honey-200 dark:border-honey-800 px-2.5 py-1.5 rounded-full hover:bg-honey-100 dark:hover:bg-honey-900 transition-colors ${className ?? ''}`}
    >
      <MessageCircle size={13} strokeWidth={2.2} />
      {label ?? 'Ask Buzz'}
    </button>
  );
}
