import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ChevronDown, ChevronUp, Check, Plus, Trash2, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { useStore } from '../store/useStore';
import { calculateHealth, HEALTH_META } from '../lib/health';
import {
  LAYING_PATTERN_OPTIONS,
  POPULATION_OPTIONS,
  STORE_LEVEL_OPTIONS,
  TEMPERAMENT_OPTIONS,
} from '../lib/hiveTypes';
import type { Concern, PopulationSize, QueenLayingPattern, StoreLevel, Temperament } from '../types';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

interface TranscriptSummary {
  date: string;
  preview: string;
  hasBeeContent: boolean;
}

interface ParsedInspection {
  hiveName?: string;
  hiveId?: string;
  queenPresent?: boolean;
  queenCells?: boolean;
  queenLayingPattern?: QueenLayingPattern;
  eggsPresent?: boolean;
  larvaePresent?: boolean;
  cappedBrood?: boolean;
  temperament?: Temperament;
  honeyStores?: StoreLevel;
  pollenStores?: StoreLevel;
  populationSize?: PopulationSize;
  concerns?: { type: string; count?: number; note?: string }[];
  notes?: string;
}

// Default empty form state
function defaultParsed(): ParsedInspection {
  return {
    queenPresent: false,
    queenCells: false,
    queenLayingPattern: 'good',
    eggsPresent: false,
    larvaePresent: false,
    cappedBrood: false,
    temperament: 'calm',
    honeyStores: 'medium',
    pollenStores: 'medium',
    populationSize: 'average',
    concerns: [],
    notes: '',
  };
}

export function OmiInspections() {
  const { hives } = useStore();
  const navigate = useNavigate();

  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<TranscriptSummary | null>(null);
  const [rawTranscript, setRawTranscript] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedInspection>(defaultParsed());
  const [hiveId, setHiveId] = useState<string>('');
  const [showRaw, setShowRaw] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Load transcript list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListError(null);
      try {
        const resp = await apiFetch(`${API_BASE}/api/omi/transcripts`);
        if (!resp.ok) throw new Error(statusToMessage(resp.status));
        const data = (await resp.json()) as TranscriptSummary[];
        if (!cancelled) {
          setTranscripts(data);
          // Default-sort: bee-related first, then newest
        }
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'Failed to load transcripts');
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // When a transcript is selected, fetch full text + parse it
  const selectTranscript = async (t: TranscriptSummary) => {
    setSelected(t);
    setParseError(null);
    setConfirmError(null);
    setCreatedId(null);
    setParsed(defaultParsed());
    setRawTranscript('');

    // Fetch full transcript text
    try {
      const resp = await apiFetch(`${API_BASE}/api/omi/transcripts/${t.date}`);
      if (!resp.ok) throw new Error(statusToMessage(resp.status));
      const data = (await resp.json()) as { text: string };
      setRawTranscript(data.text);
      await parseTranscript(data.text);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to load transcript');
    }
  };

  const parseTranscript = async (text: string) => {
    setParsing(true);
    setParseError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/omi/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      if (!resp.ok) throw new Error(statusToMessage(resp.status));
      const data = (await resp.json()) as { parsed: ParsedInspection; raw: string };
      const p = { ...defaultParsed(), ...data.parsed };
      setParsed(p);
      // Pre-select hive if Buzz matched one
      if (p.hiveId && hives.some((h) => h.id === p.hiveId)) {
        setHiveId(p.hiveId!);
      } else if (hives.length > 0) {
        setHiveId(hives[0].id);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse transcript');
    } finally {
      setParsing(false);
    }
  };

  // Health preview from current form
  const healthPreview = useMemo(() => calculateHealth({
    queenPresent: parsed.queenPresent ?? false,
    queenCells: parsed.queenCells ?? false,
    queenLayingPattern: parsed.queenLayingPattern ?? 'none',
    eggsPresent: parsed.eggsPresent ?? false,
    larvaePresent: parsed.larvaePresent ?? false,
    cappedBrood: parsed.cappedBrood ?? false,
    temperament: parsed.temperament ?? 'normal',
    honeyStores: parsed.honeyStores ?? 'none',
    pollenStores: parsed.pollenStores ?? 'none',
    populationSize: parsed.populationSize ?? 'none',
    concerns: (parsed.concerns ?? []) as Concern[],
    colonyDead: false,
  }), [parsed]);

  const set = <K extends keyof ParsedInspection>(key: K, val: ParsedInspection[K]) =>
    setParsed((p) => ({ ...p, [key]: val }));

  const addConcern = () => {
    const c: Concern = { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: '', count: undefined, note: '' };
    set('concerns', [...(parsed.concerns ?? []), c]);
  };
  const updateConcern = (idx: number, patch: Partial<Concern>) =>
    set('concerns', (parsed.concerns ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeConcern = (idx: number) =>
    set('concerns', (parsed.concerns ?? []).filter((_, i) => i !== idx));

  const handleConfirm = async () => {
    if (!hiveId) {
      setConfirmError('Please select a hive');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/omi/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed, hiveId }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || statusToMessage(resp.status));
      }
      const created = await resp.json() as { id: string };
      setCreatedId(created.id);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Failed to create inspection');
    } finally {
      setConfirming(false);
    }
  };

  const hm = HEALTH_META[healthPreview];

  // Sort transcripts: bee-related first, then newest
  const sortedTranscripts = useMemo(() => {
    return [...transcripts].sort((a, b) => {
      if (a.hasBeeContent !== b.hasBeeContent) return a.hasBeeContent ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }, [transcripts]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Voice Inspections"
        subtitle="Omi transcripts → Buzz → structured inspection"
      />

      {createdId && (
        <Card className="mb-4 bg-green-50 dark:bg-green-950 border-green-200">
          <div className="flex items-center gap-3">
            <Check size={22} className="text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">Inspection created!</p>
              <p className="text-xs text-green-600 dark:text-green-400">Buzz parsed your voice notes into a saved inspection.</p>
            </div>
            <button
              onClick={() => navigate(`/inspections/${createdId}`)}
              className="text-xs font-medium text-green-700 dark:text-green-300 underline"
            >
              View
            </button>
          </div>
        </Card>
      )}

      {!selected && (
        <>
          {loadingList && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-stone-400 dark:text-stone-500" />
              <span className="ml-2 text-sm text-stone-400 dark:text-stone-500">Loading transcripts…</span>
            </div>
          )}

          {listError && (
            <Card className="bg-red-50 dark:bg-red-950 border-red-200">
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={18} />
                {listError}
              </div>
              <p className="text-xs text-red-500 dark:text-red-400 mt-2">
                Make sure the Express server is running on {API_BASE}.
              </p>
            </Card>
          )}

          {!loadingList && !listError && sortedTranscripts.length === 0 && (
            <div className="text-center py-12">
              <Mic size={40} className="mx-auto text-stone-300 dark:text-stone-600 mb-3" />
              <p className="text-sm text-stone-400 dark:text-stone-500">No Omi transcripts found.</p>
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                Transcripts appear here when the Omi webhook writes to ~/.hermes/memories/omi-transcripts/
              </p>
            </div>
          )}

          <div className="space-y-2">
            {sortedTranscripts.map((t) => (
              <Card key={t.date} pad={false} onClick={() => selectTranscript(t)}>
                <div className="flex items-start gap-3 p-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    <FileText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-800 dark:text-stone-100 text-sm">{t.date}</span>
                      {t.hasBeeContent && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-honey-100 text-honey-700 dark:text-honey-300 font-medium">
                          🐝 Bee-related
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2">{t.preview || '(empty)'}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {selected && (
        <>
          {/* Back button */}
          <button
            onClick={() => { setSelected(null); setParsed(defaultParsed()); setRawTranscript(''); setCreatedId(null); }}
            className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 mb-3 inline-flex items-center gap-1"
          >
            ← All transcripts
          </button>

          {/* Parsing state */}
          {parsing && (
            <Card className="mb-4 bg-honey-50 dark:bg-honey-950 border-honey-200">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="animate-spin text-honey-600 dark:text-honey-400" />
                <span className="text-sm text-honey-800">Buzz is listening to your transcript…</span>
              </div>
            </Card>
          )}

          {parseError && (
            <Card className="mb-4 bg-red-50 dark:bg-red-950 border-red-200">
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={18} />
                {parseError}
              </div>
            </Card>
          )}

          {/* Buzz heard card */}
          {!parsing && !parseError && (
            <Card className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🐝</span>
                <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Buzz heard:</h3>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
                Review what Buzz parsed from your voice notes. Edit anything that's wrong, then confirm.
              </p>

              {/* Hive selector */}
              <label className="block py-2">
                <span className="text-sm font-medium text-stone-700 dark:text-stone-200 block mb-1.5">Hive</span>
                <select
                  value={hiveId}
                  onChange={(e) => setHiveId(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm"
                >
                  <option value="">— Select hive —</option>
                  {hives.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                {parsed.hiveName && !parsed.hiveId && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Buzz heard “{parsed.hiveName}” but couldn't match it — pick the right hive above.
                  </p>
                )}
              </label>

              {/* Queen Health */}
              <div className="pt-2 divide-y divide-stone-100">
                <CheckRow label="Queen present" checked={parsed.queenPresent ?? false} onChange={(v) => set('queenPresent', v)} />
                <CheckRow label="Queen cells" checked={parsed.queenCells ?? false} onChange={(v) => set('queenCells', v)} />
                <CheckRow label="Eggs present" checked={parsed.eggsPresent ?? false} onChange={(v) => set('eggsPresent', v)} />
                <CheckRow label="Larvae present" checked={parsed.larvaePresent ?? false} onChange={(v) => set('larvaePresent', v)} />
                <CheckRow label="Capped brood" checked={parsed.cappedBrood ?? false} onChange={(v) => set('cappedBrood', v)} />
              </div>

              <div className="pt-2">
                <SelectRow label="Queen laying pattern" value={parsed.queenLayingPattern ?? 'none'} options={LAYING_PATTERN_OPTIONS} onChange={(v) => set('queenLayingPattern', v as QueenLayingPattern)} />
              </div>
              <div>
                <SelectRow label="Temperament" value={parsed.temperament ?? 'normal'} options={TEMPERAMENT_OPTIONS} onChange={(v) => set('temperament', v as Temperament)} />
              </div>
              <div>
                <SelectRow label="Honey stores" value={parsed.honeyStores ?? 'none'} options={STORE_LEVEL_OPTIONS} onChange={(v) => set('honeyStores', v as StoreLevel)} />
              </div>
              <div>
                <SelectRow label="Pollen stores" value={parsed.pollenStores ?? 'none'} options={STORE_LEVEL_OPTIONS} onChange={(v) => set('pollenStores', v as StoreLevel)} />
              </div>
              <div>
                <SelectRow label="Population size" value={parsed.populationSize ?? 'none'} options={POPULATION_OPTIONS} onChange={(v) => set('populationSize', v as PopulationSize)} />
              </div>

              {/* Concerns */}
              <div className="pt-3 mt-3 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Concerns</span>
                  <button type="button" onClick={addConcern} className="text-xs text-honey-600 dark:text-honey-400 font-medium flex items-center gap-1 hover:text-honey-700">
                    <Plus size={14} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {(parsed.concerns ?? []).map((c, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-stone-50 dark:bg-stone-950 rounded-lg p-2">
                      <input
                        value={c.type}
                        onChange={(e) => updateConcern(idx, { type: e.target.value })}
                        placeholder="e.g., Varroa, SHB, Wax moth"
                        className="flex-1 min-w-0 bg-transparent text-sm border-b border-stone-200 dark:border-stone-800 pb-1 focus:border-honey-400 outline-none"
                      />
                      <input
                        type="number"
                        value={c.count ?? ''}
                        onChange={(e) => updateConcern(idx, { count: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="count"
                        className="w-16 bg-transparent text-sm border-b border-stone-200 dark:border-stone-800 pb-1 text-right focus:border-honey-400 outline-none"
                      />
                      <button type="button" onClick={() => removeConcern(idx)} className="text-stone-400 dark:text-stone-500 hover:text-red-500 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {(!parsed.concerns || parsed.concerns.length === 0) && (
                    <p className="text-xs text-stone-400 dark:text-stone-500 italic">No concerns recorded.</p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="pt-3 mt-3 border-t border-stone-100 dark:border-stone-800">
                <span className="text-sm font-semibold text-stone-700 dark:text-stone-200 block mb-1.5">Notes</span>
                <textarea
                  value={parsed.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Additional observations…"
                  rows={3}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm resize-y"
                />
              </div>

              {/* Health preview */}
              <div className="pt-3 mt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Predicted health</span>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${hm.dot}`} />
                  <span className={`text-sm font-semibold ${hm.text}`}>{hm.label}</span>
                </div>
              </div>
            </Card>
          )}

          {/* Raw transcript (collapsible) */}
          {rawTranscript && (
            <Card className="mb-4">
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Raw transcript</span>
                {showRaw ? <ChevronUp size={18} className="text-stone-400 dark:text-stone-500" /> : <ChevronDown size={18} className="text-stone-400 dark:text-stone-500" />}
              </button>
              {showRaw && (
                <pre className="mt-3 text-xs text-stone-500 dark:text-stone-400 whitespace-pre-wrap font-mono bg-stone-50 dark:bg-stone-950 rounded-lg p-3 max-h-72 overflow-y-auto">
                  {rawTranscript}
                </pre>
              )}
            </Card>
          )}

          {/* Confirm button */}
          {!parsing && !parseError && (
            <>
              {confirmError && (
                <Card className="mb-3 bg-red-50 dark:bg-red-950 border-red-200">
                  <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                    <AlertTriangle size={18} />
                    {confirmError}
                  </div>
                </Card>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setSelected(null); setParsed(defaultParsed()); setCreatedId(null); }}
                  className="flex-1 py-3 rounded-xl border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 font-medium text-sm hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={confirming || !hiveId}
                  className="flex-[2] py-3 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {confirming ? (
                    <><Loader2 size={16} className="animate-spin" /> Creating…</>
                  ) : (
                    <><Check size={16} /> Create Inspection</>
                  )}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Reused form primitives (matching InspectionForm patterns)
function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 py-2.5 w-full text-left active:bg-stone-50 dark:active:bg-stone-800 rounded-lg px-1 -mx-1"
    >
      <span className={`fancy-check ${checked ? 'checked' : ''}`}>
        {checked && <Check size={16} className="text-white" strokeWidth={3} />}
      </span>
      <span className="text-sm text-stone-700 dark:text-stone-200">{label}</span>
    </button>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="block py-2">
      <span className="text-sm font-medium text-stone-700 dark:text-stone-200 block mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}