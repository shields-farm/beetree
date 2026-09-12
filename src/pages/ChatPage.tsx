import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageCircle, AlertCircle, Sparkles, Brain, Wrench, CheckCircle2, Plus, Trash2, Clock, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { marked } from 'marked';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SensorCard } from '../components/SensorCard';
import { useChatStore } from '../lib/useChatStore';
import * as chatStore from '../lib/chatStore';

marked.setOptions({ breaks: true, gfm: true });

function uid() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderMarkdown(text: string): string {
  try { return marked.parse(text, { async: false }) as string; } catch { return text; }
}

function buildContext(
  apiaries: ReturnType<typeof useStore>['apiaries'],
  hives: ReturnType<typeof useStore>['hives'],
  inspections: ReturnType<typeof useStore>['inspections'],
  sensors: ReturnType<typeof useStore>['sensors'],
  tasks: ReturnType<typeof useStore>['tasks'],
): string {
  const alerts = generateAlerts(hives, inspections, sensors, tasks);
  const urgentAlerts = alerts.filter(a => a.severity === 'urgent').slice(0, 3);
  const lastInspection = [...inspections].sort((a, b) => b.date.localeCompare(a.date))[0];
  const openTaskCount = tasks.filter(t => !t.completed).length;

  const hiveLines = hives.map(h => {
    const apiary = apiaries.find(a => a.id === h.apiaryId);
    const lastInsp = inspections.filter(i => i.hiveId === h.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const daysSince = lastInsp ? Math.floor((Date.now() - new Date(lastInsp.date).getTime()) / 86400000) : null;
    return `- ${h.name} (${(HIVE_TYPES[h.type] || HIVE_TYPES['langstroth-10']).label}) @ ${apiary?.name ?? '?'}: ${HEALTH_META[h.healthStatus].label}, ${h.boxes.length} box(es)${daysSince !== null ? `, inspected ${daysSince}d ago` : ', never inspected'}`;
  }).join('\n');

  return `You are Buzz, a beekeeping assistant. Be concise and actionable — 2-3 sentences max, then let the cards speak. The UI renders sensor cards automatically; you don't need to list readings in text. Focus on insights and recommendations, not data dumps.

${hives.length} hives, ${sensors.length} sensors. ${urgentAlerts.length > 0 ? `URGENT: ${urgentAlerts.map(a => a.title).join('; ')}.` : 'No urgent alerts.'} ${openTaskCount > 0 ? `${openTaskCount} open tasks.` : ''} ${lastInspection ? `Last inspection: ${new Date(lastInspection.date).toLocaleDateString()}.` : 'No inspections yet.'}

HIVES:
${hiveLines || 'None'}

When asked about sensors or hives, give a 1-2 sentence summary and let the cards show the data. Use tools for detailed queries. Be direct — what should Mark do next?`;
}

export function ChatPage() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  const { sessions, activeSessionId, activeSession, messages, loading } = useChatStore();
  const [showSessionList, setShowSessionList] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate sessions from server on first mount (roaming history)
  useEffect(() => { void chatStore.hydrate(); }, []);

  // Load messages when the active session changes (lazy per-session)
  useEffect(() => {
    if (activeSessionId) void chatStore.loadMessages(activeSessionId);
  }, [activeSessionId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Create new session
  const newSession = useCallback(() => {
    const alerts = generateAlerts(hives, inspections, sensors, tasks);
    const urgentCount = alerts.filter(a => a.severity === 'urgent').length;
    const welcome: chatStore.ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: `🐝 Hi Mark! I'm Buzz, your beekeeping assistant. I can see your ${apiaries.length} apiaries, ${hives.length} hives, and ${sensors.length} sensors.\n\n${urgentCount > 0 ? `⚠️ You have **${urgentCount} urgent alert${urgentCount !== 1 ? 's' : ''}** that need attention.` : 'Everything looks good right now! 🎉'}\n\nAsk me about any hive, sensor trends, what needs attention, or what to do next.`,
      timestamp: new Date().toISOString(),
    };
    chatStore.newSession(welcome);
    setShowSessionList(false);
  }, [apiaries, hives, inspections, sensors, tasks]);

  // Auto-create first session if none exists (after server hydration settles)
  useEffect(() => {
    if (!chatStore.isHydrated()) return;
    if (sessions.length === 0 && !activeSessionId) {
      newSession();
    } else if (!activeSessionId && sessions.length > 0) {
      chatStore.setActiveSession(sessions[0].id);
    }
  }, [sessions.length, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consume initialPrompt from navigation
  const locationState = location.state as { initialPrompt?: string } | null;
  useEffect(() => {
    if (locationState?.initialPrompt && !input) {
      setInput(locationState.initialPrompt);
      navigate('/chat', { replace: true, state: {} });
    }
  }, [locationState, navigate, input]);

  const send = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input;
    if (!text.trim() || loading || !activeSessionId) return;
    const context = buildContext(apiaries, hives, inspections, sensors, tasks);
    const currentMessages = activeSession?.messages ?? [];
    setInput('');
    setError(null);
    // This runs outside React lifecycle — survives navigation
    chatStore.sendChat(activeSessionId, context, currentMessages, text);
  }, [input, loading, activeSessionId, activeSession, apiaries, hives, inspections, sensors, tasks]);

  const quickQuestions = ["Which hive needs attention?", "What's the temp trend on my hives?", "What should I do this week?", "Any swarm risk?"];

  // Session list sidebar
  if (showSessionList) {
    return (
      <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100dvh - 140px)' }}>
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setShowSessionList(false)} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700">
            <ChevronLeft size={18} /> Back
          </button>
          <h1 className="text-lg font-bold text-stone-800 dark:text-stone-100">Chat Sessions</h1>
          <button onClick={newSession} className="flex items-center gap-1 text-xs bg-honey-500 text-white px-3 py-1.5 rounded-lg hover:bg-honey-600">
            <Plus size={14} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {sessions.length === 0 && <p className="text-sm text-stone-400 text-center py-8">No sessions yet</p>}
          {sessions.map((s) => (
            <div key={s.id} className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${s.id === activeSessionId ? 'bg-honey-50 border-honey-200' : 'bg-white dark:bg-stone-900 border-stone-100 dark:border-stone-800 hover:bg-stone-50'}`}
              onClick={() => { chatStore.setActiveSession(s.id); setShowSessionList(false); }}>
              <MessageCircle size={16} className="text-stone-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-700 dark:text-stone-200 truncate">{s.title}</p>
                <p className="text-[10px] text-stone-400 flex items-center gap-1">
                  <Clock size={10} /> {new Date(s.updatedAt).toLocaleDateString()} · {s.messages.length} msgs
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); chatStore.deleteSession(s.id); }} className="p-1 text-stone-300 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100dvh - 140px)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setShowSessionList(true)} className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800">
          <MessageCircle size={20} className="text-honey-600 dark:text-honey-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-stone-800 dark:text-stone-100 truncate">{activeSession?.title ?? 'Buzz'}</h1>
          <p className="text-[11px] text-stone-400 dark:text-stone-500">Your beekeeping assistant — knows your hives</p>
        </div>
        <button onClick={newSession} className="flex items-center gap-1 text-xs bg-honey-50 dark:bg-honey-950 border border-honey-200 text-honey-700 dark:text-honey-300 px-2.5 py-1.5 rounded-lg hover:bg-honey-100">
          <Plus size={14} /> New
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4 -mx-1 px-1">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-honey-500 text-white rounded-br-md' : 'bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 text-stone-700 dark:text-stone-200 rounded-bl-md shadow-sm'}`}>
              {m.thinking && (
                <details className="mb-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-stone-400 flex items-center gap-1.5"><Brain size={12} /> Internal reasoning</summary>
                  <div className="mt-1.5 text-stone-400 whitespace-pre-wrap border-l-2 border-stone-200 dark:border-stone-700 pl-2">{m.thinking}</div>
                </details>
              )}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <details className="mb-2 rounded-lg bg-sky-50 dark:bg-sky-950 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-sky-500 flex items-center gap-1.5"><Wrench size={12} /> {m.toolCalls.length} tool call{m.toolCalls.length !== 1 ? 's' : ''}</summary>
                  <div className="mt-1.5 space-y-1.5">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="text-stone-400">
                        <div className="flex items-center gap-1 text-sky-600 font-medium"><CheckCircle2 size={10} /> {tc.name}</div>
                        <div className="ml-4 text-[10px] whitespace-pre-wrap">{tc.result.slice(0, 200)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {m.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} className="prose-chat" />
              ) : (
                <div className="whitespace-pre-wrap">{m.content}</div>
              )}
              {m.sensorCards && m.sensorCards.length > 0 && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {m.sensorCards.map((s: any) => (
                    <ErrorBoundary key={s.id}>
                      <SensorCard sensor={s} compact />
                    </ErrorBoundary>
                  ))}
                </div>
              )}
              {m.followUps && m.followUps.length > 0 && (
                <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 space-y-1.5">
                  {m.followUps.map((q, i) => (
                    <button key={i} onClick={() => send(q)} className="block w-full text-left text-xs text-honey-700 dark:text-honey-300 bg-honey-50 dark:bg-honey-950 hover:bg-honey-100 border border-honey-200 dark:border-honey-800 px-3 py-2 rounded-lg transition-colors">
                      → {q}
                    </button>
                  ))}
                </div>
              )}
              <div className={`text-[9px] mt-1 ${m.role === 'user' ? 'text-honey-200' : 'text-stone-300 dark:text-stone-600'}`}>
                {new Date(m.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
              <span className="text-xl animate-bounce inline-block">🐝</span>
            </div>
          </div>
        )}
      </div>

      {/* Quick questions */}
      {messages.length <= 1 && !loading && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <Sparkles size={12} className="text-honey-500" />
            <span className="text-[11px] text-stone-400">Try asking:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q) => (
              <button key={q} onClick={() => send(q)} className="text-xs bg-honey-50 dark:bg-honey-950 border border-honey-200 text-honey-700 dark:text-honey-300 px-2.5 py-1.5 rounded-full hover:bg-honey-100">{q}</button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mb-2 flex items-center gap-2 text-xs text-red-500 px-1"><AlertCircle size={14} /> {error}</div>}

      <div className="flex gap-2 items-end pt-2 border-t border-stone-100 dark:border-stone-800">
        <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about your hives…" rows={1}
          className="flex-1 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm resize-none max-h-24"
          style={{ minHeight: '44px' }} />
        <button onClick={() => send()} disabled={!input.trim() || loading}
          className="w-11 h-11 rounded-xl bg-honey-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-honey-600">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}