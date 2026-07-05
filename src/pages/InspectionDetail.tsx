import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Check, AlertTriangle, Mic } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '../store/useStore';
import { SectionCard } from '../components/Card';
import { HEALTH_META } from '../lib/health';
import { HIVE_TYPES } from '../lib/hiveTypes';

export function InspectionDetail({ id }: { id: string }) {
  const { inspections, hives, deleteInspection } = useStore();
  const navigate = useNavigate();
  const insp = inspections.find((i) => i.id === id);

  if (!insp) {
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400">Inspection not found.</p>
        <Link to="/inspections" className="text-honey-600 text-sm underline mt-2 inline-block">Back to inspections</Link>
      </div>
    );
  }

  const hive = hives.find((h) => h.id === insp.hiveId);
  const meta = HEALTH_META[insp.healthStatus];

  const Field = ({ label, value }: { label: string; value: string | boolean }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-stone-500">{label}</span>
      {typeof value === 'boolean' ? (
        value ? <Check size={16} className="text-green-600" /> : <span className="text-stone-300 text-sm">—</span>
      ) : (
        <span className="text-sm font-medium text-stone-800 capitalize">{value}</span>
      )}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <Link to="/inspections" className="text-xs text-stone-400 hover:text-stone-600 mb-2 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Inspections
      </Link>

      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-stone-800 truncate">{hive?.name ?? 'Unknown hive'}</h1>
          <p className="text-sm text-stone-500 mt-0.5">{format(new Date(insp.date), 'EEEE, MMM d, yyyy · h:mm a')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/inspections/new?editId=${insp.id}`}
            className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center"
          >
            <Pencil size={16} />
          </Link>
          <button
            onClick={() => {
              if (confirm('Delete this inspection?')) {
                deleteInspection(insp.id);
                navigate('/inspections');
              }
            }}
            className="w-10 h-10 rounded-full bg-stone-100 text-red-500 flex items-center justify-center"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Health banner */}
      <div className={`rounded-xl ${meta.bg} px-4 py-3 mb-4 flex items-center justify-between`}>
        <span className={`text-sm font-semibold ${meta.text}`}>Overall Health</span>
        <span className={`text-sm font-bold ${meta.text}`}>{meta.label}{insp.healthAutoCalculated ? ' (auto)' : ''}</span>
      </div>

      {insp.colonyDead && (
        <div className="rounded-xl bg-red-100 px-4 py-3 mb-4 flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-600" />
          <span className="text-sm font-semibold text-red-700">Colony found dead</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <SectionCard title="Brood & Queen">
          <div className="divide-y divide-stone-50">
            <Field label="Queen present" value={insp.queenPresent} />
            <Field label="Queen cells" value={insp.queenCells} />
            <Field label="Laying pattern" value={insp.queenLayingPattern} />
          </div>
        </SectionCard>

        <SectionCard title="Brood Status">
          <div className="divide-y divide-stone-50">
            <Field label="Eggs present" value={insp.eggsPresent} />
            <Field label="Larvae present" value={insp.larvaePresent} />
            <Field label="Capped brood" value={insp.cappedBrood} />
          </div>
        </SectionCard>

        <SectionCard title="Temperament">
          <Field label="Bee temperament" value={insp.temperament.replace('-', ' ')} />
        </SectionCard>

        <SectionCard title="Resources">
          <div className="divide-y divide-stone-50">
            <Field label="Honey stores" value={insp.honeyStores} />
            <Field label="Pollen stores" value={insp.pollenStores} />
          </div>
        </SectionCard>

        <SectionCard title="Colony Population">
          <Field label="Population size" value={insp.populationSize} />
        </SectionCard>

        <SectionCard title="Hive Weight">
          <Field label="Weight" value={`${insp.hiveWeight} lbs`} />
        </SectionCard>
      </div>

      {insp.concerns.length > 0 && (
        <SectionCard title="Counts & Concerns" className="mt-4">
          <div className="space-y-1.5">
            {insp.concerns.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1">
                <span className="text-stone-700">{c.type}</span>
                <span className="font-medium text-stone-800">
                  {c.count !== undefined ? `${c.count}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {insp.notes && (
        <SectionCard title="Notes" className="mt-4">
          <p className="text-sm text-stone-600 whitespace-pre-wrap">{insp.notes}</p>
        </SectionCard>
      )}

      {/* Media */}
      {insp.media && insp.media.length > 0 ? (
        <SectionCard title="Photos, Video & Voice" className="mt-4">
          <div className="space-y-3">
            {insp.media.filter((m) => m.type === 'photo').length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {insp.media.filter((m) => m.type === 'photo').map((p) => (
                  <div key={p.id} className="rounded-lg overflow-hidden aspect-square">
                    <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            {insp.media.filter((m) => m.type === 'video').map((v) => (
              <div key={v.id} className="rounded-lg overflow-hidden bg-stone-900">
                <video src={v.dataUrl} controls className="w-full max-h-48" />
              </div>
            ))}
            {insp.media.filter((m) => m.type === 'audio').map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-100 p-2.5">
                <Mic size={16} className="text-purple-600 shrink-0" />
                <audio src={a.dataUrl} controls className="flex-1 h-8" />
              </div>
            ))}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Photos, Video & Voice" className="mt-4">
          <p className="text-xs text-stone-400 text-center py-2">No media attached.</p>
        </SectionCard>
      )}

      {hive && (
        <Link
          to={`/hives/${hive.id}`}
          className="mt-4 block text-center text-xs text-stone-400 hover:text-honey-600"
        >
          View hive: {hive.name} ({HIVE_TYPES[hive.type].label}) →
        </Link>
      )}
    </div>
  );
}