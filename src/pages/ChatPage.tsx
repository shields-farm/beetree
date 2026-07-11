import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageCircle, AlertCircle, Sparkles, Brain, Wrench, CheckCircle2, Plus, Trash2, Clock, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { API_BASE, apiFetch } from '../lib/apiBase';
import { marked } from 'marked';
import { A2UIChatRenderer } from '../components/A2UIChatRenderer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SensorCard } from '../components/SensorCard';

marked.setOptions({ breaks: true, gfm: true });

interface ChatMessage {
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

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

function uid() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sid() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SESSIONS_KEY = 'beetree-chat-sessions';
const ACTIVE_KEY = 'beetree-chat-active';

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveSessions(sessions: ChatSession[]) {
  try {
    // Keep last 10 sessions, 50 messages each
    const trimmed = sessions.slice(0, 10).map(s => ({
      ...s,
      messages: s.messages.slice(-50),
    }));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota */ }
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
  const recentInspections = [...inspections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const hiveSummaries = hives.map((h) => {
    const apiary = apiaries.find((a) => a.id === h.apiaryId);
    const hiveSensors = sensors.filter((s) => s.hiveId === h.id);
    const lastInsp = inspections.filter((i) => i.hiveId === h.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const hm = HEALTH_META[h.healthStatus];
    const sensorInfo = hiveSensors.length > 0
      ? hiveSensors.map((s) => {
          const r = s.latestReading;
          return r ? `${s.name} (${s.model}): ${r.temperature.toFixed(1)}°F, ${r.humidity.toFixed(0)}% humidity, ${r.batteryVoltage.toFixed(1)}V batt` : `${s.name} (${s.model}): no reading`;
        }).join('; ')
      : 'no sensors';
    const lastInspInfo = lastInsp
      ? `last inspected ${new Date(lastInsp.date).toLocaleDateString()}, health: ${hm.label}${lastInsp.queenPresent ? ', queen present' : ', no queen'}${lastInsp.notes ? `, notes: ${lastInsp.notes.slice(0, 80)}` : ''}`
      : 'never inspected';
    return `  - ${h.name} (${(HIVE_TYPES[h.type] || HIVE_TYPES['langstroth-10']).label}) at ${apiary?.name ?? 'unknown apiary'}: health ${hm.label}, ${h.boxes.length} box(es), ${sensorInfo}, ${lastInspInfo}`;
  }).join('\n');

  const alertInfo = alerts.length > 0
    ? alerts.slice(0, 10).map((a) => `  - [${a.severity}] ${a.title}: ${a.message}`).join('\n')
    : '  No active alerts.';

  const taskInfo = tasks.filter((t) => !t.completed).slice(0, 10).map((t) => {
    const hive = hives.find((h) => h.id === t.hiveId);
    return `  - ${t.title}${hive ? ` (${hive.name})` : ''}${t.dueDate ? ` due ${new Date(t.dueDate).toLocaleDateString()}` : ''} [${t.priority}]`;
  }).join('\n');

  return `You are Buzz, Mark's beekeeping assistant. You have full context about his apiary operation below. Be helpful, specific, and proactive — suggest actions when you see something that needs attention. Keep responses concise and practical. Use **markdown** formatting for emphasis, lists, and structure.

CURRENT APIARY STATE:
${apiaries.length} apiary(ies), ${hives.length} hive(s), ${sensors.length} sensor(s), ${inspections.length} inspection(s) recorded.

HIVES:
${hiveSummaries || '  No hives yet.'}

ACTIVE ALERTS ("It's time to..."):
${alertInfo}

OPEN TASKS:
${taskInfo || '  No open tasks.'}

RECENT INSPECTIONS:
${recentInspections.map((i) => {
    const hive = hives.find((h) => h.id === i.hiveId);
    return `  - ${hive?.name ?? 'Unknown'}: ${new Date(i.date).toLocaleDateString()} — ${HEALTH_META[i.healthStatus].label}${i.queenPresent ? ', queen ✓' : ', no queen'}${i.notes ? `, "${i.notes.slice(0, 60)}"` : ''}`;
}).join('\n') || '  No inspections yet.'}

When the user asks about a specific hive, use the data above to give a concrete answer. If they ask about something you don't have data for, say so. Proactively mention if a hive is overdue for inspection or if sensor readings look off.

After your response, on a new line, suggest 2-3 follow-up questions the user might ask next. Format them as a JSON array on its own line, prefixed with "FOLLOW_UP:" like this:
FOLLOW_UP: ["What should I inspect next?", "How does this compare to last week?", "When should I feed?"]
Keep the suggestions short (under 50 chars each) and directly related to the conversation.

You can also generate A2UI (Agent-to-User Interface) messages to create rich interactive UIs. A2UI is a declarative JSON format where you send component descriptions that the client renders natively. To send A2UI, include a JSON array prefixed with "A2UI:" on its own line:
A2UI: [{"version":"v0.9","createSurface":{"surfaceId":"hive-summary","catalogId":"basic"}},{"version":"v0.9","updateComponents":{"surfaceId":"hive-summary","components":[{"id":"root","component":"Card","child":"content"},{"id":"content","component":"Column","children":["title","temp"]},{"id":"title","component":"Text","text":{"path":"/title"}},{"id":"temp","component":"Text","text":{"path":"/temp"}}]}},{"version":"v0.9","updateDataModel":{"surfaceId":"hive-summary","path":"/","value":{"title":"Hive 1 Status","temp":"100.65°F, thriving"}}}]
Use A2UI when showing structured data like hive summaries, sensor readings, or action forms. Use Text, Card, Column, Row, Button, List, and other basic components. Keep A2UI messages on one line.`;
}

export function ChatPage() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_KEY) || null;
  });
  const [showSessionList, setShowSessionList] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusSteps, setStatusSteps] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const messages = activeSession?.messages ?? [];

  // Persist sessions
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // Persist active session ID
  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_KEY, activeSessionId);
  }, [activeSessionId]);

  // Consume initialPrompt from navigation
  const locationState = location.state as { initialPrompt?: string } | null;
  useEffect(() => {
    if (locationState?.initialPrompt && !input) {
      setInput(locationState.initialPrompt);
      navigate('/chat', { replace: true, state: {} });
    }
  }, [locationState, navigate, input]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, statusSteps]);

  // Create new session
  const newSession = useCallback(() => {
    const alerts = generateAlerts(hives, inspections, sensors, tasks);
    const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;
    const warningCount = alerts.filter((a) => a.severity === 'warning').length;
    const welcome: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: `🐝 Hi Mark! I'm Buzz, your beekeeping assistant. I can see your ${apiaries.length} apiaries, ${hives.length} hives, and ${sensors.length} sensors.\n\n${urgentCount > 0 ? `⚠️ You have **${urgentCount} urgent alert${urgentCount !== 1 ? 's' : ''}** that need attention.` : ''}\n${warningCount > 0 ? `🟡 **${warningCount} warning${warningCount !== 1 ? 's' : ''}** to review.` : ''}\n${urgentCount === 0 && warningCount === 0 ? 'Everything looks good right now! 🎉' : ''}\n\nAsk me about any hive, sensor trends, what needs attention, or what to do next.`,
      timestamp: new Date().toISOString(),
    };
    const session: ChatSession = {
      id: sid(),
      title: 'New Chat',
      messages: [welcome],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setShowSessionList(false);
  }, [apiaries, hives, inspections, sensors, tasks]);

  // Auto-create first session if none exists
  useEffect(() => {
    if (sessions.length === 0 && !activeSessionId) {
      newSession();
    } else if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining[0]?.id ?? null);
      if (remaining.length === 0) {
        setTimeout(() => newSession(), 100);
      }
    }
  };

  const updateSession = (id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  };

  const send = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input;
    if (!text.trim() || loading || !activeSessionId) return;

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text.trim(), timestamp: new Date().toISOString() };

    // Update session with user message + auto-title
    updateSession(activeSessionId, (s) => ({
      ...s,
      title: s.messages.length <= 1 ? text.trim().slice(0, 40) : s.title,
      messages: [...s.messages, userMsg],
      updatedAt: new Date().toISOString(),
    }));
    setInput('');
    setLoading(true);
    setError(null);
    setStatusSteps(['Thinking…']);

    const context = buildContext(apiaries, hives, inspections, sensors, tasks);
    const currentMessages = activeSession?.messages ?? [];

    try {
      const messagesPayload = [
        { role: 'system' as const, content: context },
        ...currentMessages.map((m) => ({ role: m.role as string, content: m.content })),
        { role: 'user' as const, content: userMsg.content },
      ];

      const response = await apiFetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesPayload }),
      });

      if (!response.ok) throw new Error(`BeeTree API returned ${response.status}`);

      const data = await response.json();
      const rawContent = data.content ?? 'No response from AI.';
      // Strip any FOLLOW_UP/A2UI tags the model might have added (we use server-generated ones)
      const cleanContent = rawContent
        .replace(/FOLLOW_UP:\s*\[[\s\S]*?\]/, '').trim()
        .replace(/A2UI:\s*\[[\s\S]*?\]/, '').trim();
      const assistantContent = cleanContent;
      // Use server-generated follow-ups and A2UI messages (deterministic, always present)
      const followUps = (data.followUps as string[]) || [];
      const a2uiMessages = (data.a2uiMessages as any[]) || [];
      const sensorCards = (data.sensorCards as any[]) || undefined;
      const toolCalls = data.toolCalls as { name: string; args: string; result: string }[] | undefined;
      const thinking = data.thinking as string | undefined;

      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: [...s.messages, {
          id: uid(), role: 'assistant', content: assistantContent, timestamp: new Date().toISOString(),
          thinking, toolCalls,
          followUps: followUps.length > 0 ? followUps : undefined,
          a2uiMessages: a2uiMessages.length > 0 ? a2uiMessages : undefined,
          sensorCards,
        }],
        updatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response');
      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: [...s.messages, {
          id: uid(), role: 'assistant',
          content: "Sorry, I couldn't reach the AI backend.\n\nError: " + (err instanceof Error ? err.message : 'Unknown error'),
          timestamp: new Date().toISOString(),
        }],
      }));
    } finally {
      setLoading(false);
      setStatusSteps([]);
    }
  }, [input, loading, activeSessionId, activeSession, apiaries, hives, inspections, sensors, tasks]);

  const quickQuestions = ["Which hive needs attention?", "What's the temp trend on my hives?", "What should I do this week?", "Any swarm risk?"];

  // Session list sidebar
  if (showSessionList) {
    return (
      <div className="animate-fade-in flex flex-col" style={{ height: "calc(100dvh - 140px)" }}>
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
              onClick={() => { setActiveSessionId(s.id); setShowSessionList(false); }}>
              <MessageCircle size={16} className="text-stone-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-700 dark:text-stone-200 truncate">{s.title}</p>
                <p className="text-[10px] text-stone-400 flex items-center gap-1">
                  <Clock size={10} /> {new Date(s.updatedAt).toLocaleDateString()} · {s.messages.length} msgs
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} className="p-1 text-stone-300 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: "calc(100dvh - 140px)" }}>
      {/* Header with session controls */}
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
              {m.a2uiMessages && m.a2uiMessages.length > 0 && (
                <div className="mt-2">
                  <ErrorBoundary>
                    <A2UIChatRenderer messages={m.a2uiMessages} />
                  </ErrorBoundary>
                </div>
              )}
              {/* Native sensor cards (same styling as Sensors page) */}
              {m.sensorCards && m.sensorCards.length > 0 && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {m.sensorCards.map((s: any) => (
                    <SensorCard key={s.id} sensor={s} compact />
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
              {statusSteps.length > 0 ? (
                <div className="space-y-1.5">
                  {statusSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-stone-500">
                      <span className="w-3 h-3 rounded-full border-2 border-honey-400 border-t-transparent animate-spin shrink-0" /> {step}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick questions (only on first message) */}
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