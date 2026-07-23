import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PenLine,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Check,
  Trash2,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { HEALTH_META, calculateHealth } from '../lib/health';
import {
  LAYING_PATTERN_OPTIONS,
  POPULATION_OPTIONS,
  STORE_LEVEL_OPTIONS,
  TEMPERAMENT_OPTIONS,
} from '../lib/hiveTypes';
import type { Concern, PopulationSize, QueenLayingPattern, StoreLevel, Temperament } from '../types';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

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

export function QuickInspect() {
  const { hives } = useStore();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedInspection | null>(null);
  const [raw, setRaw] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [hiveId, setHiveId] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setParseError(null);
    setParsed(null);
    setCreated(null);
    setConfirmError(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/inspect/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || statusToMessage(resp.status));
      }
      const data = (await resp.json()) as { parsed: ParsedInspection; raw: string };
      const p = { ...defaultParsed(), ...data.parsed };
      setParsed(p);
      setRaw(data.raw);
      if (p.hiveId && hives.some((h) => h.id === p.hiveId)) {
        setHiveId(p.hiveId);
      } else if (hives.length > 0 && !hiveId) {
        setHiveId(hives[0].id);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse notes');
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsed || !hiveId) {
      setConfirmError('Please select a hive');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/inspect/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed, hiveId }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || statusToMessage(resp.status));
      }
      const createdInsp = (await resp.json()) as { id: string };
      setCreated(createdInsp);
      setParsed(null);
      setText('');
      setRaw('');
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Failed to create inspection');
    } finally {
      setConfirming(false);
    }
  };

  const set = <K extends keyof ParsedInspection>(key: K, val: ParsedInspection[K]) =>
    setParsed((p) => (p ? { ...p, [key]: val } : p));

  const addConcern = () => {
    if (!parsed) return;
    const c: Concern = { id: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), type: '', count: undefined, note: '' };
    set('concerns', [...(parsed.concerns ?? []), c]);
  };
  const updateConcern = (idx: number, patch: Partial<Concern>) =>
    set('concerns', (parsed?.concerns ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeConcern = (idx: number) =>
    set('concerns', (parsed?.concerns ?? []).filter((_, i) => i !== idx));

  const healthPreview = useMemo(() => {
    if (!parsed) return 'good' as const;
    return calculateHealth({
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
    });
  }, [parsed]);

  const hm = HEALTH_META[healthPreview];

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Quick Inspect"
        subtitle="Type notes — Buzz fills the form"
        action={
          <button
            onClick={() => navigate(-1)}
            className="lg:hidden flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400"
          >
            <ChevronLeft size={18} /> Back
          </button>
        }
      />

      {/* Created success banner */}
      {created && (
        <Card className="bg-green-50 dark:bg-green-950 border-green-200">
          <div className="flex items-center gap-3">
            <Check size={22} className="text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">Inspection created!</p>
              <p className="text-xs text-green-600 dark:text-green-400">Buzz parsed your notes into a saved inspection.</p>
            </div>
            <button
              onClick={() => navigate('/inspections/' + created.id)}
              className="text-xs font-medium text-green-700 dark:text-green-300 underline"
            >
              View
            </button>
          </div>
        </Card>
      )}

      {/* Text input */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <PenLine size={18} className="text-honey-600 dark:text-honey-400" />
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Inspection notes</h3>
        </div>
        <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
          Type or paste your observations. Buzz will parse them into a structured inspection.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g., Hive 2 — queen seen, good brood pattern, eggs and larvae present, calm temperament, honey stores medium, saw 3 queen cells on frame 4, varroa count 12.'}
          rows={5}
          className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm resize-y"
        />
        <button
          type="button"
          onClick={handleParse}
          disabled={parsing || !text.trim()}
          className="mt-3 w-full py-2.5 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {parsing ? (
            <><Loader2 size={16} className="animate-spin" /> Parsing with Buzz…</>
          ) : (
            <><Sparkles size={16} /> Parse with Buzz</>
          )}
        </button>
      </Card>

      {/* Parse error */}
      {parseError && (
        <Card className="bg-red-50 dark:bg-red-950 border-red-200">
          <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Parse failed</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{parseError}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Confirm error */}
      {confirmError && (
        <Card className="bg-red-50 dark:bg-red-950 border-red-200">
          <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Couldn't create inspection</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{confirmError}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Parsed result */}
      {parsed && (
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🐝</span>
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Buzz parsed:</h3>
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
            Review what Buzz filled in. Edit anything that's wrong, then create the inspection.
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
                Buzz heard "{parsed.hiveName}" but couldn't match it — pick the right hive above.
              </p>
            )}
          </label>

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
              <span className={'inline-block w-2.5 h-2.5 rounded-full ' + hm.dot} />
              <span className={'text-sm font-semibold ' + hm.text}>{hm.label}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Raw notes (collapsible) */}
      {raw && (
        <Card>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Raw notes</span>
            {showRaw ? <ChevronUp size={18} className="text-stone-400 dark:text-stone-500" /> : <ChevronDown size={18} className="text-stone-400 dark:text-stone-500" />}
          </button>
          {showRaw && (
            <pre className="mt-3 text-xs text-stone-500 dark:text-stone-400 whitespace-pre-wrap font-mono bg-stone-50 dark:bg-stone-950 rounded-lg p-3 max-h-72 overflow-y-auto">
              {raw}
            </pre>
          )}
        </Card>
      )}

      {/* Confirm button */}
      {parsed && (
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => { setParsed(null); setRaw(''); setConfirmError(null); }}
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
      )}
    </div>
  );
}

// ─── Form primitives ──────────────────────────────────────────────────────────

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 py-2.5 w-full text-left active:bg-stone-50 dark:active:bg-stone-800 rounded-lg px-1 -mx-1"
    >
      <span className={'fancy-check ' + (checked ? 'checked' : '')}>
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