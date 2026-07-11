import { BOX_CONTENT_META, BOX_CONTENT_ORDER } from '../lib/hiveTypes';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Check, AlertTriangle } from 'lucide-react';
import type { Concern, Inspection, MediaItem, QueenLayingPattern, StoreLevel, Temperament, PopulationSize, HealthStatus } from '../types';
import {
  LAYING_PATTERN_OPTIONS,
  POPULATION_OPTIONS,
  STORE_LEVEL_OPTIONS,
  TEMPERAMENT_OPTIONS,
  HEALTH_OPTIONS,
} from '../lib/hiveTypes';
import { calculateHealth, HEALTH_META } from '../lib/health';
import { LabelSlider, Slider } from './Slider';
import { MediaCapture } from './MediaCapture';
import { uid } from '../store/useStore';

export interface InspectionFormData {
  hiveId: string;
  date: string;
  queenPresent: boolean;
  queenCells: boolean;
  queenLayingPattern: QueenLayingPattern;
  eggsPresent: boolean;
  larvaePresent: boolean;
  cappedBrood: boolean;
  temperament: Temperament;
  honeyStores: StoreLevel;
  pollenStores: StoreLevel;
  populationSize: PopulationSize;
  hiveWeight: number;
  healthStatus: HealthStatus;
  healthAutoCalculated: boolean;
  concerns: Concern[];
  colonyDead: boolean;
  notes: string;
  photoUrls: string[];
  media: MediaItem[];
}

function defaultForm(hiveId: string): InspectionFormData {
  return {
    hiveId,
    date: new Date().toISOString().slice(0, 16),
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
    hiveWeight: 0,
    healthStatus: 'good',
    healthAutoCalculated: true,
    concerns: [],
    colonyDead: false,
    notes: '',
    photoUrls: [],
    media: [],
  };
}

export function inspectionToForm(i: Inspection): InspectionFormData {
  const { id: _id, ...rest } = i;
  return rest;
}

interface Props {
  hiveId: string;
  initial?: InspectionFormData;
  onSubmit: (data: InspectionFormData) => void;
  onCancel: () => void;
  submitLabel?: string;
  boxes?: { id: string; type: string; content?: string }[];
  onBoxContentChange?: (boxId: string, content: string) => void;
}

function SectionTitle({ children, icon }: { children: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">{children}</h3>
    </div>
  );
}

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
        className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm dark:text-stone-100 appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function InspectionForm({ hiveId, initial, onSubmit, onCancel, submitLabel = 'Save Inspection', boxes, onBoxContentChange }: Props) {
  const [form, setForm] = useState<InspectionFormData>(initial ?? defaultForm(hiveId));
  const [manualHealth, setManualHealth] = useState(!form.healthAutoCalculated);

  const autoHealth = useMemo(
    () => calculateHealth(form),
    [form],
  );

  const health = manualHealth ? form.healthStatus : autoHealth;

  const set = <K extends keyof InspectionFormData>(key: K, val: InspectionFormData[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const addConcern = () => {
    const c: Concern = { id: uid('concern'), type: '', count: undefined, note: '' };
    set('concerns', [...form.concerns, c]);
  };

  const updateConcern = (id: string, patch: Partial<Concern>) =>
    set('concerns', form.concerns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeConcern = (id: string) => set('concerns', form.concerns.filter((c) => c.id !== id));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      healthStatus: health,
      healthAutoCalculated: !manualHealth,
    });
  };

  const hm = HEALTH_META[health];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ─── PILLAR 1: QUEEN HEALTH ─── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">👑</span>
          <div>
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">Queen Health</h3>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">Pillar 1 of 3 — Jamie Ellis</p>
          </div>
        </div>
        <div className="divide-y divide-stone-100">
          <CheckRow label="Queen present" checked={form.queenPresent} onChange={(v) => set('queenPresent', v)} />
          <CheckRow label="Queen cells" checked={form.queenCells} onChange={(v) => set('queenCells', v)} />
        </div>
        <div className="pt-2">
          <SelectRow
            label="Queen laying pattern"
            value={form.queenLayingPattern}
            options={LAYING_PATTERN_OPTIONS}
            onChange={(v) => set('queenLayingPattern', v as QueenLayingPattern)}
          />
        </div>
        <div className="pt-2 divide-y divide-stone-100">
          <CheckRow label="Eggs present" checked={form.eggsPresent} onChange={(v) => set('eggsPresent', v)} />
          <CheckRow label="Larvae present" checked={form.larvaePresent} onChange={(v) => set('larvaePresent', v)} />
          <CheckRow label="Capped brood" checked={form.cappedBrood} onChange={(v) => set('cappedBrood', v)} />
        </div>
        <div className="pt-2">
          <SelectRow
            label="Bee temperament"
            value={form.temperament}
            options={TEMPERAMENT_OPTIONS}
            onChange={(v) => set('temperament', v as Temperament)}
          />
        </div>
      </div>

      {/* ─── PILLAR 2: NUTRITION ─── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🍯</span>
          <div>
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">Nutrition</h3>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">Pillar 2 of 3 — honey &amp; pollen stores, population</p>
          </div>
        </div>
        <LabelSlider<StoreLevel>
          label="Honey stores"
          value={form.honeyStores}
          options={STORE_LEVEL_OPTIONS}
          onChange={(v) => set('honeyStores', v)}
        />
        <LabelSlider<StoreLevel>
          label="Pollen stores"
          value={form.pollenStores}
          options={STORE_LEVEL_OPTIONS}
          onChange={(v) => set('pollenStores', v)}
        />
        <LabelSlider<PopulationSize>
          label="Population size"
          value={form.populationSize}
          options={POPULATION_OPTIONS}
          onChange={(v) => set('populationSize', v)}
        />
        <Slider
          label="Hive weight"
          value={form.hiveWeight}
          min={0}
          max={250}
          step={1}
          onChange={(v) => set('hiveWeight', v)}
          displayValue={`${form.hiveWeight} lbs`}
        />
      </div>

      {/* ─── PILLAR 3: PESTS & DISEASES ─── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐝</span>
            <div>
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">Pests &amp; Diseases</h3>
              <p className="text-[10px] text-stone-400 dark:text-stone-500">Pillar 3 of 3 — varroa, SHB, concerns</p>
            </div>
          </div>
          <button type="button" onClick={addConcern} className="text-xs text-honey-600 font-medium flex items-center gap-1 hover:text-honey-700">
            <Plus size={14} /> Add
          </button>
        </div>

        <div className="space-y-2">
          {form.concerns.map((c) => (
            <div key={c.id} className="flex items-start gap-2 bg-stone-50 dark:bg-stone-800 rounded-lg p-2">
              <input
                value={c.type}
                onChange={(e) => updateConcern(c.id, { type: e.target.value })}
                placeholder="e.g., Varroa mites, Small hive beetles, Wax moths"
                className="flex-1 min-w-0 bg-transparent text-sm dark:text-stone-100 border-b border-stone-200 dark:border-stone-700 pb-1 focus:border-honey-400 outline-none"
              />
              <input
                type="number"
                value={c.count ?? ''}
                onChange={(e) => updateConcern(c.id, { count: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="count"
                className="w-16 bg-transparent text-sm dark:text-stone-100 border-b border-stone-200 dark:border-stone-700 pb-1 text-right focus:border-honey-400 outline-none"
              />
              <button type="button" onClick={() => removeConcern(c.id)} className="text-stone-400 dark:text-stone-500 hover:text-red-500 p-1">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {form.concerns.length === 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 italic">No concerns recorded. Tap "Add" to log varroa counts, beetles, moths, etc.</p>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          <CheckRow
            label="Colony found dead"
            checked={form.colonyDead}
            onChange={(v) => set('colonyDead', v)}
          />
          {form.colonyDead && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle size={13} /> Marked as dead — health will be set to Critical.
            </div>
          )}
        </div>
      </div>

      {/* Overall Health Summary */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📋</span>
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">Overall Health</h3>
        </div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${hm.dot}`} />
            <span className={`text-sm font-semibold ${hm.text}`}>{hm.label}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <input
              type="checkbox"
              checked={manualHealth}
              onChange={(e) => setManualHealth(e.target.checked)}
              className="accent-honey-500"
            />
            Override manually
          </label>
        </div>
        {manualHealth ? (
          <div className="flex gap-1.5 flex-wrap">
            {HEALTH_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => set('healthStatus', o.value as HealthStatus)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  form.healthStatus === o.value
                    ? 'bg-honey-500 text-white'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400 dark:text-stone-500">Auto-calculated from the three pillars above.</p>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <SectionTitle>Notes</SectionTitle>
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Observations, weather, forage notes…"
          rows={4}
          className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm dark:text-stone-100 resize-y"
        />
      </div>

      {/* Photos, Video & Voice */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
        <SectionTitle>Photos, Video &amp; Voice</SectionTitle>
        <MediaCapture
          media={form.media}
          onAdd={(item) => set('media', [...form.media, item])}
          onRemove={(id) => set('media', form.media.filter((m) => m.id !== id))}
        />
      </div>

      {/* ─── BOX CONTENT QUICK SET ─── */}
      {boxes && boxes.length > 0 && onBoxContentChange && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📦</span>
            <div>
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 uppercase tracking-wide">Box Content</h3>
              <p className="text-[10px] text-stone-400 dark:text-stone-500">Quick-set what each box is majority of</p>
            </div>
          </div>
          <div className="space-y-2">
            {boxes.map((box, idx) => (
              <div key={box.id} className="flex items-center gap-2">
                <span className="text-xs text-stone-500 w-16 shrink-0">Box {idx + 1}</span>
                <div className="flex gap-1 flex-wrap">
                  {(BOX_CONTENT_ORDER as readonly string[]).map((c) => {
                    const meta = BOX_CONTENT_META[c];
                    const active = box.content === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onBoxContentChange(box.id, c)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all flex items-center gap-0.5 ${
                          active ? 'ring-2 ring-honey-500 scale-105' : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{ background: meta.color, color: meta.textColor }}
                      >
                        {meta.icon} {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 font-medium text-sm hover:bg-stone-50 dark:hover:bg-stone-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-[2] py-3 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors shadow-sm"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}