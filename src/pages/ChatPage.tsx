import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageCircle, AlertCircle, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

function uid() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    return `  - ${h.name} (${HIVE_TYPES[h.type].label}) at ${apiary?.name ?? 'unknown apiary'}: health ${hm.label}, ${h.boxes.length} box(es), ${sensorInfo}, ${lastInspInfo}`;
  }).join('\n');

  const alertInfo = alerts.length > 0
    ? alerts.slice(0, 10).map((a) => `  - [${a.severity}] ${a.title}: ${a.message}`).join('\n')
    : '  No active alerts.';

  const taskInfo = tasks.filter((t) => !t.completed).slice(0, 10).map((t) => {
    const hive = hives.find((h) => h.id === t.hiveId);
    return `  - ${t.title}${hive ? ` (${hive.name})` : ''}${t.dueDate ? ` due ${new Date(t.dueDate).toLocaleDateString()}` : ''} [${t.priority}]`;
  }).join('\n');

  return `You are BeeTree AI, Mark's beekeeping assistant. You have full context about his apiary operation below. Be helpful, specific, and proactive — suggest actions when you see something that needs attention. Keep responses concise and practical.

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

When the user asks about a specific hive, use the data above to give a concrete answer. If they ask about something you don't have data for, say so. Proactively mention if a hive is overdue for inspection or if sensor readings look off.`;
}

export function ChatPage() {
  const { apiaries, hives, inspections, sensors, tasks } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Welcome message on first load
  useEffect(() => {
    if (messages.length === 0) {
      const alerts = generateAlerts(hives, inspections, sensors, tasks);
      const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;
      const warningCount = alerts.filter((a) => a.severity === 'warning').length;

      setMessages([{
        id: uid(),
        role: 'assistant',
        content: `🐝 Hi Mark! I'm BeeTree AI, your beekeeping assistant. I can see your ${apiaries.length} apiaries, ${hives.length} hives, and ${sensors.length} sensors.

${urgentCount > 0 ? `⚠️ You have ${urgentCount} urgent alert${urgentCount !== 1 ? 's' : ''} that need attention.` : ''}
${warningCount > 0 ? `🟡 ${warningCount} warning${warningCount !== 1 ? 's' : ''} to review.` : ''}
${urgentCount === 0 && warningCount === 0 ? 'Everything looks good right now! 🎉' : ''}

Ask me about any hive, sensor trends, what needs attention, or what to do next. I have full context on your operation.`,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      // BeeTree scoped subagent via Hermes API server (port 8643)
      // This is a dedicated profile with only HA read-only access — no terminal, file, or system tools
      const beetreeUrl = 'http://192.0.2.20:8643/v1/chat/completions';
      const beetreeKey = 'dev-beetree-api-key-replace-me';

      const messages_payload = [
          { role: 'system' as const, content: context },
          ...messages.map((m) => ({ role: m.role as string, content: m.content })),
          { role: 'user' as const, content: userMsg.content },
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
        throw new Error(`BeeTree API returned ${response.status}. Make sure the Beetree gateway is running: \`beetree gateway start\``);
      }

      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content ?? 'No response from AI.';

      setMessages((m) => [...m, {
        id: uid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString(),
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
        <MessageCircle size={20} className="text-honey-600" />
        <div>
          <h1 className="text-lg font-bold text-stone-800">BeeTree AI</h1>
          <p className="text-[11px] text-stone-400">Your beekeeping assistant — knows your hives</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4 -mx-1 px-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-honey-500 text-white rounded-br-md'
                  : 'bg-white border border-stone-100 text-stone-700 rounded-bl-md shadow-sm'
              }`}
            >
              {m.content}
              <div className={`text-[9px] mt-1 ${m.role === 'user' ? 'text-honey-200' : 'text-stone-300'}`}>
                {new Date(m.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-100 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-honey-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
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

      {/* Error */}
      {error && (
        <div className="mb-2 flex items-center gap-2 text-xs text-red-500 px-1">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end pt-2 border-t border-stone-100">
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
          className="flex-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm resize-none max-h-24"
          style={{ minHeight: '44px' }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="w-11 h-11 rounded-xl bg-honey-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-honey-600"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}