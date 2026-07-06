import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, X, Sparkles, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChat } from './ChatContext';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

function uid() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildContext(
  apiaries: ReturnType<typeof useStore>['apiaries'],
  hives: ReturnType<typeof useStore>['hives'],
  inspections: ReturnType<typeof useStore>['inspections'],
  sensors: ReturnType<typeof useStore>['sensors'],
  tasks: ReturnType<typeof useStore>['tasks'],
): string {
  const alerts = generateAlerts(hives, inspections, sensors, tasks);
  const recentInspections = [...inspections]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const hiveSummaries = hives.map((h) => {
    const apiary = apiaries.find((a) => a.id === h.apiaryId);
    const hiveSensors = sensors.filter((s) => s.hiveId === h.id);
    const lastInsp = inspections
      .filter((i) => i.hiveId === h.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const hm = HEALTH_META[h.healthStatus];
    const sensorInfo = hiveSensors.length > 0
      ? hiveSensors.map((s) => {
          const r = s.latestReading;
          return r ? `${s.name}: ${r.temperature.toFixed(1)}F, ${r.humidity.toFixed(0)}% humidity, ${r.batteryVoltage.toFixed(1)}V` : `${s.name}: no reading`;
        }).join('; ')
      : 'no sensors';
    const lastInspInfo = lastInsp
      ? `last inspected ${new Date(lastInsp.date).toLocaleDateString()}, health: ${hm.label}${lastInsp.queenPresent ? ', queen present' : ', no queen'}`
      : 'never inspected';
    return `  - ${h.name} (${HIVE_TYPES[h.type].label}) at ${apiary?.name ?? 'unknown'}: ${hm.label}, ${h.boxes.length} box(es), ${sensorInfo}, ${lastInspInfo}`;
  }).join('\n');

  const alertInfo = alerts.length > 0
    ? alerts.slice(0, 10).map((a) => `  - [${a.severity}] ${a.title}: ${a.message}`).join('\n')
    : '  No active alerts.';

  const taskInfo = tasks.filter((t) => !t.completed).slice(0, 10).map((t) => {
    const hive = hives.find((h) => h.id === t.hiveId);
    return `  - ${t.title}${hive ? ` (${hive.name})` : ''}${t.dueDate ? ` due ${new Date(t.dueDate).toLocaleDateString()}` : ''}`;
  }).join('\n');

  return `You are Buzz, a UGA Master Craftsman Beekeeper (University of Georgia Master Beekeeper program) with the expertise, wit, and evidence-based approach of Dr. Jamie Ellis. You are Mark's dedicated beekeeping assistant. Be warm, witty, evidence-based, practical, and proactive. Keep responses concise. Use "it's time to..." framing for actionable suggestions. When you see something concerning, say so.

CURRENT STATE:
${apiaries.length} apiary(ies), ${hives.length} hive(s), ${sensors.length} sensor(s), ${inspections.length} inspection(s).

HIVES:
${hiveSummaries || '  No hives yet.'}

ALERTS:
${alertInfo}

OPEN TASKS:
${taskInfo || '  No open tasks.'}

RECENT INSPECTIONS:
${recentInspections.map((i) => {
  const hive = hives.find((h) => h.id === i.hiveId);
  return `  - ${hive?.name ?? 'Unknown'}: ${new Date(i.date).toLocaleDateString()} — ${HEALTH_META[i.healthStatus].label}${i.queenPresent ? ', queen present' : ', no queen'}${i.notes ? `, "${i.notes.slice(0, 60)}"` : ''}`;
}).join('\n') || '  No inspections yet.'}`;
}

export function FloatingChat() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();
  const { isOpen, setIsOpen, pendingPrompt, clearPendingPrompt, quickQuestions } = useChat();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Restore from localStorage on mount
    try {
      const saved = localStorage.getItem('beetree-chat-messages');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('beetree-chat-messages', JSON.stringify(messages));
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }, [messages]);

  // Sync local open state with context
  useEffect(() => {
    setOpen(isOpen);
  }, [isOpen]);

  const toggleOpen = useCallback((v: boolean) => {
    setOpen(v);
    setIsOpen(v);
  }, [setIsOpen]);

  // Consume pending prompt from context (e.g., from AskAIButton)
  useEffect(() => {
    if (pendingPrompt && open) {
      setInput(pendingPrompt);
      clearPendingPrompt();
      // Auto-focus so user can hit Enter to send
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [pendingPrompt, open, clearPendingPrompt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const clearChat = useCallback(() => {
    setMessages([]);
    localStorage.removeItem('beetree-chat-messages');
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    const context = buildContext(apiaries, hives, inspections, sensors, tasks);

    try {
      const beetreeUrl = 'http://192.0.2.10:8643/v1/chat/completions';
      const beetreeKey = 'dev-beetree-api-key-replace-me';

      const messages_payload = [
        { role: 'system', content: context },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMsg.content },
      ];

      const response = await fetch(beetreeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${beetreeKey}`,
        },
        body: JSON.stringify({
          model: 'beetree',
          messages: messages_payload,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`BeeTree API ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content ?? 'No response.';

      setMessages((m) => [...m, {
        id: uid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString(),
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setMessages((m) => [...m, {
        id: uid(),
        role: 'assistant',
        content: "I can't reach Buzz right now. Make sure the beetree gateway is running on the Mac Mini.",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, apiaries, hives, inspections, sensors, tasks]);

  const pageQuestions = quickQuestions.length > 0 ? quickQuestions : [
    "Which hive needs attention?",
    "What should I do this week?",
    "Any swarm risk?",
  ];

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => toggleOpen(true)}
          className="fixed bottom-20 lg:bottom-6 right-4 z-50 w-14 h-14 rounded-full bg-honey-500 text-white shadow-lg flex items-center justify-center hover:bg-honey-600 active:scale-95 transition-all"
          aria-label="Ask Buzz"
        >
          <MessageCircle size={26} />
          {(messages.length === 0 || loading) && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {loading ? '…' : '!'}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 w-[calc(100vw-2rem)] sm:w-96 max-h-[70vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-honey-500 text-white">
            <div className="flex items-center gap-2">
              <MessageCircle size={18} />
              <div>
                <div className="text-sm font-bold">Buzz</div>
                <div className="text-[10px] opacity-90">UGA Master Craftsman</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-1.5 hover:bg-white/20 rounded-lg text-[10px] font-medium"
                  title="Clear conversation"
                >
                  Clear
                </button>
              )}
              <button onClick={() => toggleOpen(false)} className="p-1 hover:bg-white/20 rounded-lg">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] max-h-[50vh]">
            {messages.length === 0 && (
              <div className="text-center py-4">
                <Sparkles size={24} className="text-honey-400 mx-auto mb-2" />
                <p className="text-sm text-stone-600 font-medium">Ask Buzz about your hives</p>
                <p className="text-xs text-stone-400 mt-1">I know your apiaries, sensors, and inspection history</p>
                <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                  {pageQuestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setInput(q);
                        inputRef.current?.focus();
                      }}
                      className="text-xs bg-honey-50 border border-honey-200 text-honey-700 px-2.5 py-1.5 rounded-full hover:bg-honey-100"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-honey-500 text-white rounded-br-md'
                    : 'bg-stone-100 text-stone-700 rounded-bl-md'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-stone-100 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 pb-1 flex items-center gap-2 text-xs text-red-500">
              <AlertCircle size={12} /> {error}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2 items-end p-3 border-t border-stone-100">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your hives…"
              rows={1}
              className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm resize-none max-h-20"
              style={{ minHeight: '40px' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-honey-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-honey-600"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}