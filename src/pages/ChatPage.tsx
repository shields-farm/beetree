import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageCircle, AlertCircle, Sparkles, Brain, Wrench, CheckCircle2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { API_BASE, apiFetch } from '../lib/apiBase';
import { marked } from 'marked';
import { A2UIChatRenderer } from '../components/A2UIChatRenderer';

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
}

function uid() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Extract FOLLOW_UP: [...] and A2UI: [...] from the end of an AI response */
function parseFollowUps(text: string): { content: string; followUps: string[]; a2uiMessages: any[] } {
  let followUps: string[] = [];
  let a2uiMessages: any[] = [];
  let content = text;

  // Parse FOLLOW_UP
  const fuMatch = content.match(/FOLLOW_UP:\s*(\[[\s\S]*?\])/);
  if (fuMatch) {
    try {
      followUps = JSON.parse(fuMatch[1]) as string[];
      content = content.replace(fuMatch[0], '').trim();
    } catch { /* malformed JSON, ignore */ }
  }

  // Parse A2UI
  const a2Match = content.match(/A2UI:\s*(\[[\s\S]*?\])/);
  if (a2Match) {
    try {
      a2uiMessages = JSON.parse(a2Match[1]) as any[];
      content = content.replace(a2Match[0], '').trim();
    } catch { /* malformed JSON, ignore */ }
  }

  return { content, followUps: followUps.slice(0, 4), a2uiMessages };
}

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    return text;
  }
}

/**
 * Build beekeeping context from the current app state.
 * This gets injected as a system prompt so the AI assistant
 * knows about your apiaries, hives, sensors, and inspections.
 */
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
          return r
            ? `${s.name} (${s.model}): ${r.temperature.toFixed(1)}°F, ${r.humidity.toFixed(0)}% humidity, ${r.batteryVoltage.toFixed(1)}V batt`
            : `${s.name} (${s.model}): no reading`;
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('beetree-chat-history');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusSteps, setStatusSteps] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('beetree-chat-history', JSON.stringify(messages.slice(-50)));
    } catch { /* ignore quota errors */ }
  }, [messages]);

  // Consume initialPrompt from navigation state (set by AskAIButton)
  const locationState = location.state as { initialPrompt?: string } | null;
  useEffect(() => {
    if (locationState?.initialPrompt && !input) {
      setInput(locationState.initialPrompt);
      navigate('/chat', { replace: true, state: {} });
    }
  }, [locationState, navigate, input]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, statusSteps]);

  // Welcome message on first load (only if no persisted history)
  useEffect(() => {
    if (messages.length === 0) {
      const alerts = generateAlerts(hives, inspections, sensors, tasks);
      const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;
      const warningCount = alerts.filter((a) => a.severity === 'warning').length;

      setMessages([{
        id: uid(),
        role: 'assistant',
        content: `🐝 Hi Mark! I'm Buzz, your beekeeping assistant. I can see your ${apiaries.length} apiaries, ${hives.length} hives, and ${sensors.length} sensors.

${urgentCount > 0 ? `⚠️ You have **${urgentCount} urgent alert${urgentCount !== 1 ? 's' : ''}** that need attention.` : ''}
${warningCount > 0 ? `🟡 **${warningCount} warning${warningCount !== 1 ? 's' : ''}** to review.` : ''}
${urgentCount === 0 && warningCount === 0 ? 'Everything looks good right now! 🎉' : ''}

Ask me about any hive, sensor trends, what needs attention, or what to do next. I have full context on your operation.`,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input;
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);
    setStatusSteps([]);

    const context = buildContext(apiaries, hives, inspections, sensors, tasks);

    try {
      // Route through BeeTree Express server → Hermes API server
      const messages_payload = [
        { role: 'system' as const, content: context },
        ...messages.map((m) => ({ role: m.role as string, content: m.content })),
        { role: 'user' as const, content: userMsg.content },
      ];

      setStatusSteps(['Thinking…']);

      const response = await apiFetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages_payload }),
      });

      if (!response.ok) {
        throw new Error(`BeeTree API returned ${response.status}. Make sure the Beetree gateway is running: \`beetree gateway start\``);
      }

      const data = await response.json();
      const rawContent = data.content ?? 'No response from AI.';
      const { content: assistantContent, followUps, a2uiMessages } = parseFollowUps(rawContent);
      const toolCalls = data.toolCalls as { name: string; args: string; result: string }[] | undefined;
      const thinking = data.thinking as string | undefined;

      setMessages((m) => [...m, {
        id: uid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString(),
        thinking,
        toolCalls,
        followUps: followUps.length > 0 ? followUps : undefined,
        a2uiMessages: a2uiMessages.length > 0 ? a2uiMessages : undefined,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response');
      setMessages((m) => [...m, {
        id: uid(),
        role: 'assistant',
        content: "Sorry, I couldn't reach the AI backend. Make sure Hermes API server or Ollama is running on the Mac Mini.\n\nError: " + (err instanceof Error ? err.message : 'Unknown error'),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      setStatusSteps([]);
    }
  }, [input, loading, messages, apiaries, hives, inspections, sensors, tasks]);

  const quickQuestions = [
    "Which hive needs attention?",
    "What's the temp trend on my hives?",
    "What should I do this week?",
    "Any swarm risk?",
  ];

  return (
    <div className="animate-fade-in flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle size={20} className="text-honey-600 dark:text-honey-400" />
        <div>
          <h1 className="text-lg font-bold text-stone-800 dark:text-stone-100">Buzz</h1>
          <p className="text-[11px] text-stone-400 dark:text-stone-500">Your beekeeping assistant — knows your hives</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4 -mx-1 px-1">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-honey-500 text-white rounded-br-md' : 'bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 text-stone-700 dark:text-stone-200 rounded-bl-md shadow-sm'}`}>
              {/* Thinking / internal reasoning (collapsible) */}
              {m.thinking && (
                <details className="mb-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-stone-400 dark:text-stone-500 flex items-center gap-1.5">
                    <Brain size={12} /> Internal reasoning
                  </summary>
                  <div className="mt-1.5 text-stone-400 dark:text-stone-500 whitespace-pre-wrap border-l-2 border-stone-200 dark:border-stone-700 pl-2">
                    {m.thinking}
                  </div>
                </details>
              )}
              {/* Tool calls (collapsible) */}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <details className="mb-2 rounded-lg bg-sky-50 dark:bg-sky-950 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-sky-500 flex items-center gap-1.5">
                    <Wrench size={12} /> {m.toolCalls.length} tool call{m.toolCalls.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="text-stone-400 dark:text-stone-500">
                        <div className="flex items-center gap-1 text-sky-600 dark:text-sky-400 font-medium">
                          <CheckCircle2 size={10} /> {tc.name}
                        </div>
                        <div className="ml-4 text-[10px] whitespace-pre-wrap">{tc.result.slice(0, 200)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {/* Content — rendered as markdown for assistant, plain for user */}
              {m.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} className="prose-chat" />
              ) : (
                <div className="whitespace-pre-wrap">{m.content}</div>
              )}
              {/* A2UI rich interactive surfaces */}
              {m.a2uiMessages && m.a2uiMessages.length > 0 && (
                <div className="mt-2">
                  <A2UIChatRenderer messages={m.a2uiMessages} />
                </div>
              )}
              {/* Follow-up question buttons */}
              {m.followUps && m.followUps.length > 0 && (
                <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 space-y-1.5">
                  {m.followUps.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => send(q)}
                      className="block w-full text-left text-xs text-honey-700 dark:text-honey-300 bg-honey-50 dark:bg-honey-950 hover:bg-honey-100 dark:hover:bg-honey-900 border border-honey-200 dark:border-honey-800 px-3 py-2 rounded-lg transition-colors"
                    >
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
        {/* Working indicator with steps */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
              {statusSteps.length > 0 ? (
                <div className="space-y-1.5">
                  {statusSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                      <span className="w-3 h-3 rounded-full border-2 border-honey-400 border-t-transparent animate-spin shrink-0" />
                      {step}
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

      {/* Quick questions */}
      {messages.length <= 1 && !loading && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <Sparkles size={12} className="text-honey-500" />
            <span className="text-[11px] text-stone-400 dark:text-stone-500">Try asking:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q) => (
              <button key={q} onClick={() => send(q)} className="text-xs bg-honey-50 dark:bg-honey-950 border border-honey-200 text-honey-700 dark:text-honey-300 px-2.5 py-1.5 rounded-full hover:bg-honey-100">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-2 flex items-center gap-2 text-xs text-red-500 dark:text-red-400 px-1">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end pt-2 border-t border-stone-100 dark:border-stone-800">
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
          className="flex-1 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm resize-none max-h-24"
          style={{ minHeight: '44px' }}
        />
        <button onClick={() => send()} disabled={!input.trim() || loading} className="w-11 h-11 rounded-xl bg-honey-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-honey-600">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}