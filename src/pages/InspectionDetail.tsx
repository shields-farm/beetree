import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Check, AlertTriangle, Mic, Loader2, Crown, Droplets, Tornado, Bug, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { SectionCard } from '../components/Card';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';
import { API_BASE, apiFetch } from '../lib/apiBase';
import type { Inspection } from '../types';

export function InspectionDetail({ id }: { id: string }) {
  const { inspections, hives, deleteInspection, syncFromServer } = useStore();
  const { setQuickQuestions } = useChat();
  const navigate = useNavigate();
  const insp = inspections.find((i) => i.id === id);

  // If not in store, try fetching from server directly (handles reload before sync)
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [fallbackInsp, setFallbackInsp] = useState<Inspection | null>(null);

  useEffect(() => {
    if (!insp && fetchState === 'idle') {
      setFetchState('loading');
      apiFetch(API_BASE + '/api/inspections/' + id)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) setFallbackInsp(data);
          // Also trigger a store sync in the background
          syncFromServer().catch(() => {});
        })
        .catch(() => {})
        .finally(() => setFetchState('done'));
    }
  }, [id, insp, fetchState, syncFromServer]);

  // Use store inspection first, fallback to fetched one
  const active = insp ?? fallbackInsp;

  const hive = active ? hives.find((h) => h.id === active.hiveId) : undefined;

  // Page-specific quick questions about this inspection
  // (must be before any conditional return to satisfy rules-of-hooks)
  useEffect(() => {
    if (!active) return;
    const hiveName = hive?.name ?? 'this hive';
    const qs: string[] = [];
    // Three-pillar focused questions
    if (!active.queenPresent) qs.push(`${hiveName} has no queen — what are my options?`);
    if (active.queenCells) qs.push(`${hiveName} has queen cells — is it swarming or supersedure?`);
    if (active.honeyStores === 'none' || active.honeyStores === 'low') qs.push(`${hiveName} has low honey stores — should I feed?`);
    if (active.concerns.length > 0) qs.push(`Analyze the pest/disease concerns from this inspection`);
    if (qs.length === 0) qs.push(`What does this inspection tell me about ${hiveName}?`);
    qs.push(`What should I do next for ${hiveName}?`);
    setQuickQuestions(qs);
    return () => setQuickQuestions([]);
  }, [active, hive, setQuickQuestions]);

  if (!active) {
    // Show loading spinner while fetching, or if we haven't tried yet
    if (fetchState !== 'done') {
      return (
        <div className="animate-fade-in flex flex-col items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-honey-500 mb-3" />
          <p className="text-sm text-stone-400 dark:text-stone-500">Loading inspection…</p>
        </div>
      );
    }
    // Fetch completed but no data — genuinely not found
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400 dark:text-stone-500">Inspection not found.</p>
        <Link to="/inspections" className="text-honey-600 dark:text-honey-400 text-sm underline mt-2 inline-block">Back to inspections</Link>
      </div>
    );
  }

  const meta = HEALTH_META[active.healthStatus];

  // Categorize concerns into the three pillars + swarm + other
  const QUEEN_KEYWORDS = ['queen', 'laying', 'brood pattern', 'requeening', 'queenless', 'supersedure'];
  const NUTRITION_KEYWORDS = ['resource', 'honey', 'pollen', 'stores', 'food', 'nectar', 'feeding'];
  const SWARM_KEYWORDS = ['swarm', 'congestion', 'expansion', 'overcrowding'];
  const PEST_KEYWORDS = ['varroa', 'mite', 'shb', 'small hive beetle', 'wax moth', 'ant', 'pest'];
  const DISEASE_KEYWORDS = ['foulbrood', 'afb', 'efb', 'chalkbrood', 'sacbrood', 'nosema', 'disease', 'dwv', 'virus'];

  const categorize = (type: string) => {
    const t = type.toLowerCase();
    if (PEST_KEYWORDS.some((k) => t.includes(k)) || DISEASE_KEYWORDS.some((k) => t.includes(k))) return 'pest';
    if (SWARM_KEYWORDS.some((k) => t.includes(k))) return 'swarm';
    if (QUEEN_KEYWORDS.some((k) => t.includes(k))) return 'queen';
    if (NUTRITION_KEYWORDS.some((k) => t.includes(k))) return 'nutrition';
    return 'other';
  };

  const queenConcerns = active.concerns.filter((c) => categorize(c.type) === 'queen');
  const nutritionConcerns = active.concerns.filter((c) => categorize(c.type) === 'nutrition');
  const swarmConcerns = active.concerns.filter((c) => categorize(c.type) === 'swarm');
  const pestDiseaseConcerns = active.concerns.filter((c) => categorize(c.type) === 'pest');
  const otherConcerns = active.concerns.filter((c) => categorize(c.type) === 'other');

  const Field = ({ label, value }: { label: string; value: string | boolean }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-stone-500 dark:text-stone-400">{label}</span>
      {typeof value === 'boolean' ? (
        value ? <Check size={16} className="text-green-600 dark:text-green-400" /> : <span className="text-stone-300 dark:text-stone-600 text-sm">—</span>
      ) : (
        <span className="text-sm font-medium text-stone-800 dark:text-stone-100 capitalize">{value}</span>
      )}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <Link to="/inspections" className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 mb-2 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Inspections
      </Link>

      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100 truncate">{hive?.name ?? 'Unknown hive'}</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">{format(new Date(active.date), 'EEEE, MMM d, yyyy · h:mm a')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/inspections/new?editId=${active.id}`}
            className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 flex items-center justify-center"
          >
            <Pencil size={16} />
          </Link>
          <button
            onClick={() => {
              if (confirm('Delete this inspection?')) {
                deleteInspection(active.id);
                navigate('/inspections');
              }
            }}
            className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-red-500 dark:text-red-400 flex items-center justify-center"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Health banner */}
      <div className={`rounded-xl ${meta.bg} px-4 py-3 mb-4 flex items-center justify-between`}>
        <span className={`text-sm font-semibold ${meta.text}`}>Overall Health</span>
        <span className={`text-sm font-bold ${meta.text}`}>{meta.label}{active.healthAutoCalculated ? ' (auto)' : ''}</span>
      </div>

      {/* Ask AI about this inspection */}
      <div className="mb-4">
        <AskAIButton prompt={`Analyze this inspection of ${hive?.name ?? 'the hive'}: health is ${meta.label}, queen ${active.queenPresent ? 'present' : 'absent'}, honey stores ${active.honeyStores}, ${active.concerns.length} concern(s). What are the three-pillar takeaways (queen health, nutrition, pests/diseases)?`} label="Analyze this inspection" />
      </div>

      {active.colonyDead && (
        <div className="rounded-xl bg-red-100 dark:bg-red-900 px-4 py-3 mb-4 flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">Colony found dead</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Pillar 1: Queen Health */}
        <SectionCard title="Queen Health" icon={<Crown size={16} className="text-amber-500" />}>
          <div className="divide-y divide-stone-50">
            <Field label="Queen present" value={active.queenPresent} />
            <Field label="Queen cells" value={active.queenCells} />
            <Field label="Laying pattern" value={active.queenLayingPattern} />
            <Field label="Eggs present" value={active.eggsPresent} />
            <Field label="Larvae present" value={active.larvaePresent} />
            <Field label="Capped brood" value={active.cappedBrood} />
            <Field label="Temperament" value={active.temperament.replace('-', ' ')} />
          </div>
          {queenConcerns.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-50 space-y-1.5">
              {queenConcerns.map((c) => (
                <div key={c.id} className="flex items-start justify-between text-sm py-1 gap-2">
                  <span className="text-stone-700 dark:text-stone-200 shrink-0">{c.type}</span>
                  <span className="font-medium text-stone-800 dark:text-stone-100 text-right">
                    {c.count != null && c.count !== 0 ? `${c.count}` : ''}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Pillar 2: Nutrition */}
        <SectionCard title="Nutrition" icon={<Droplets size={16} className="text-honey-500" />}>
          <div className="divide-y divide-stone-50">
            <Field label="Honey stores" value={active.honeyStores} />
            <Field label="Pollen stores" value={active.pollenStores} />
            <Field label="Population size" value={active.populationSize} />
            <Field label="Hive weight" value={`${active.hiveWeight} lbs`} />
          </div>
          {nutritionConcerns.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-50 space-y-1.5">
              {nutritionConcerns.map((c) => (
                <div key={c.id} className="flex items-start justify-between text-sm py-1 gap-2">
                  <span className="text-stone-700 dark:text-stone-200 shrink-0">{c.type}</span>
                  <span className="font-medium text-stone-800 dark:text-stone-100 text-right">
                    {c.count != null && c.count !== 0 ? `${c.count}` : ''}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {swarmConcerns.length > 0 && (
        <SectionCard title="Swarm Risk" className="mt-4" icon={<Tornado size={16} className="text-sky-500" />}>
          <div className="space-y-1.5">
            {swarmConcerns.map((c) => (
              <div key={c.id} className="flex items-start justify-between text-sm py-1 gap-2">
                <span className="text-stone-700 dark:text-stone-200 shrink-0">{c.type}</span>
                <span className="font-medium text-stone-800 dark:text-stone-100 text-right">
                  {c.count != null && c.count !== 0 ? `${c.count}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {pestDiseaseConcerns.length > 0 && (
        <SectionCard title="Pests & Diseases" className="mt-4" icon={<Bug size={16} className="text-orange-500" />}>
          <div className="space-y-1.5">
            {pestDiseaseConcerns.map((c) => (
              <div key={c.id} className="flex items-start justify-between text-sm py-1 gap-2">
                <span className="text-stone-700 dark:text-stone-200 shrink-0">{c.type}</span>
                <span className="font-medium text-stone-800 dark:text-stone-100 text-right">
                  {c.count != null && c.count !== 0 ? `${c.count}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {otherConcerns.length > 0 && (
        <SectionCard title="Other Notes" className="mt-4" icon={<FileText size={16} className="text-stone-400" />}>
          <div className="space-y-1.5">
            {otherConcerns.map((c) => (
              <div key={c.id} className="flex items-start justify-between text-sm py-1 gap-2">
                <span className="text-stone-700 dark:text-stone-200 shrink-0">{c.type}</span>
                <span className="font-medium text-stone-800 dark:text-stone-100 text-right">
                  {c.count != null && c.count !== 0 ? `${c.count}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {active.notes && (
        <SectionCard title="Notes" className="mt-4">
          <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">{active.notes}</p>
        </SectionCard>
      )}

      {/* Media */}
      {active.media && active.media.length > 0 ? (
        <SectionCard title="Photos, Video & Voice" className="mt-4">
          <div className="space-y-3">
            {active.media.filter((m) => m.type === 'photo').length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {active.media.filter((m) => m.type === 'photo').map((p) => (
                  <div key={p.id} className="rounded-lg overflow-hidden aspect-square">
                    <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            {active.media.filter((m) => m.type === 'video').map((v) => (
              <div key={v.id} className="rounded-lg overflow-hidden bg-stone-900">
                <video src={v.dataUrl} controls className="w-full max-h-48" />
              </div>
            ))}
            {active.media.filter((m) => m.type === 'audio').map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-950 border border-purple-100 p-2.5 dark:border-purple-800">
                <Mic size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
                <audio src={a.dataUrl} controls className="flex-1 h-8" />
              </div>
            ))}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Photos, Video & Voice" className="mt-4">
          <p className="text-xs text-stone-400 dark:text-stone-500 text-center py-2">No media attached.</p>
        </SectionCard>
      )}

      {hive && (
        <Link
          to={`/hives/${hive.id}`}
          className="mt-4 block text-center text-xs text-stone-400 dark:text-stone-500 hover:text-honey-600"
        >
          View hive: {hive.name} ({HIVE_TYPES[hive.type].label}) →
        </Link>
      )}
    </div>
  );
}