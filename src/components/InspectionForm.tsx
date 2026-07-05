import { useMemo, useState } from 'react';
import { Plus, Trash2, Mic, Camera, Check, AlertTriangle } from 'lucide-react';
import type { Concern, Inspection, QueenLayingPattern, StoreLevel, Temperament, PopulationSize, HealthStatus } from '../types';
import {
  LAYING_PATTERN_OPTIONS,
  POPULATION_OPTIONS,
  STORE_LEVEL_OPTIONS,
  TEMPERAMENT_OPTIONS,
  HEALTH_OPTIONS,
} from '../lib/hiveTypes';
import { calculateHealth, HEALTH_META } from '../lib/health';
import { LabelSlider, Slider } from './Slider';
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
}

function SectionTitle({ children, icon }: { children: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wide">{children}</h3>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 py-2.5 w-full text-left active:bg-stone-50 rounded-lg px-1 -mx-1"
    >
      <span className={`fancy-check ${checked ? 'checked' : ''}`}>
        {checked && <Check size={16} className="text-white" strokeWidth={3} />}
      </span>
      <span className="text-sm text-stone-700">{label}</span>
    </button>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="block py-2">
      <span className="text-sm font-medium text-stone-700 block mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function InspectionForm({ hiveId, initial, onSubmit, onCancel, submitLabel = 'Save Inspection' }: Props) {
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
      {/* Brood & Queen */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Brood &amp; Queen</SectionTitle>
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
      </div>

      {/* Brood Status */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Brood Status</SectionTitle>
        <div className="divide-y divide-stone-100">
          <CheckRow label="Eggs present" checked={form.eggsPresent} onChange={(v) => set('eggsPresent', v)} />
          <CheckRow label="Larvae present" checked={form.larvaePresent} onChange={(v) => set('larvaePresent', v)} />
          <CheckRow label="Capped brood" checked={form.cappedBrood} onChange={(v) => set('cappedBrood', v)} />
        </div>
      </div>

      {/* Temperament */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Temperament</SectionTitle>
        <SelectRow
          label="Bee temperament"
          value={form.temperament}
          options={TEMPERAMENT_OPTIONS}
          onChange={(v) => set('temperament', v as Temperament)}
        />
      </div>

      {/* Resources */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4 space-y-5">
        <SectionTitle>Resources</SectionTitle>
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
      </div>

      {/* Population */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Colony Population</SectionTitle>
        <LabelSlider<PopulationSize>
          label="Population size"
          value={form.populationSize}
          options={POPULATION_OPTIONS}
          onChange={(v) => set('populationSize', v)}
        />
      </div>

      {/* Weight */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Hive Weight</SectionTitle>
        <Slider
          label="Weight"
          value={form.hiveWeight}
          min={0}
          max={250}
          step={1}
          onChange={(v) => set('hiveWeight', v)}
          displayValue={`${form.hiveWeight} lbs`}
        />
      </div>

      {/* Health */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Overall Health</SectionTitle>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${hm.dot}`} />
            <span className={`text-sm font-semibold ${hm.text}`}>{hm.label}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-500">
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
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">Auto-calculated from inspection fields.</p>
        )}
      </div>

      {/* Concerns */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Counts &amp; Concerns</SectionTitle>
          <button type="button" onClick={addConcern} className="text-xs text-honey-600 font-medium flex items-center gap-1 hover:text-honey-700">
            <Plus size={14} /> Add
          </button>
        </div>

        <div className="space-y-2">
          {form.concerns.map((c) => (
            <div key={c.id} className="flex items-start gap-2 bg-stone-50 rounded-lg p-2">
              <input
                value={c.type}
                onChange={(e) => updateConcern(c.id, { type: e.target.value })}
                placeholder="Concern type (e.g., Varroa count)"
                className="flex-1 min-w-0 bg-transparent text-sm border-b border-stone-200 pb-1 focus:border-honey-400 outline-none"
              />
              <input
                type="number"
                value={c.count ?? ''}
                onChange={(e) => updateConcern(c.id, { count: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="count"
                className="w-16 bg-transparent text-sm border-b border-stone-200 pb-1 text-right focus:border-honey-400 outline-none"
              />
              <button type="button" onClick={() => removeConcern(c.id)} className="text-stone-400 hover:text-red-500 p-1">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {form.concerns.length === 0 && (
            <p className="text-xs text-stone-400 italic">No concerns recorded. Tap "Add" to log varroa counts, beetles, etc.</p>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-stone-100">
          <CheckRow
            label="Colony found dead"
            checked={form.colonyDead}
            onChange={(v) => set('colonyDead', v)}
          />
          {form.colonyDead && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle size={13} /> Marked as dead — health will be set to Critical.
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Notes</SectionTitle>
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Observations, weather, forage notes…"
          rows={4}
          className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm resize-y"
        />
      </div>

      {/* Photos & Voice */}
      <div className="bg-white rounded-2xl shadow-card border border-stone-100 p-4">
        <SectionTitle>Photos &amp; Voice</SectionTitle>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 py-3 rounded-xl border border-dashed border-stone-300 text-stone-500 text-sm flex flex-col items-center gap-1 hover:border-honey-400 hover:text-honey-600"
          >
            <Camera size={20} />
            <span>Attach Photo</span>
          </button>
          <button
            type="button"
            className="flex-1 py-3 rounded-xl border border-dashed border-stone-300 text-stone-500 text-sm flex flex-col items-center gap-1 hover:border-honey-400 hover:text-honey-600"
          >
            <Mic size={20} />
            <span>Voice Note</span>
            <span className="text-[9px] text-stone-400">coming soon</span>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-stone-200 text-stone-600 font-medium text-sm hover:bg-stone-50"
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