import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { HEALTH_META } from '../lib/health';
import { InspectionForm, type InspectionFormData } from '../components/InspectionForm';
import type { Inspection } from '../types';

export function InspectionList() {
  const { inspections, hives } = useStore();
  const sorted = [...inspections].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Inspections"
        subtitle={`${inspections.length} record${inspections.length !== 1 ? 's' : ''}`}
        action={
          <Link
            to="/inspections/new"
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600"
            title="New inspection"
          >
            <Plus size={22} />
          </Link>
        }
      />

      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList size={40} className="mx-auto text-stone-300 mb-3" />
          <p className="text-sm text-stone-400 mb-3">No inspections yet.</p>
          <Link to="/inspections/new" className="inline-flex items-center gap-1.5 text-honey-600 text-sm font-medium">
            <Plus size={16} /> Record your first inspection
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((i) => {
            const hive = hives.find((h) => h.id === i.hiveId);
            const meta = HEALTH_META[i.healthStatus];
            return (
              <Card key={i.id} onClick={() => {}} pad={false}>
                <Link to={`/inspections/${i.id}`} className="flex items-center gap-3 p-4">
                  <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                    <ClipboardList size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-stone-800 truncate">{hive?.name ?? 'Unknown hive'}</div>
                    <div className="text-xs text-stone-400">{format(new Date(i.date), 'MMM d, yyyy · h:mm a')}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function inspectionToForm(i: Inspection): InspectionFormData {
  return {
    hiveId: i.hiveId,
    date: i.date.slice(0, 16),
    queenPresent: i.queenPresent,
    queenCells: i.queenCells,
    queenLayingPattern: i.queenLayingPattern,
    eggsPresent: i.eggsPresent,
    larvaePresent: i.larvaePresent,
    cappedBrood: i.cappedBrood,
    temperament: i.temperament,
    honeyStores: i.honeyStores,
    pollenStores: i.pollenStores,
    populationSize: i.populationSize,
    hiveWeight: i.hiveWeight,
    healthStatus: i.healthStatus,
    healthAutoCalculated: i.healthAutoCalculated,
    concerns: i.concerns,
    colonyDead: i.colonyDead,
    notes: i.notes,
    photoUrls: i.photoUrls,
  };
}

export function InspectionFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { hives, inspections, addInspection, updateInspection, updateHive } = useStore();
  const hiveId = params.get('hiveId') ?? hives[0]?.id ?? '';
  const editId = params.get('editId');
  const existing = editId ? inspections.find((i) => i.id === editId) : undefined;
  const hive = hives.find((h) => h.id === (existing?.hiveId ?? hiveId));

  if (!hive && !existing) {
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400">Select a hive first. No hives available — create one in the Hives tab.</p>
        <Link to="/hives" className="text-honey-600 text-sm underline mt-2 inline-block">Go to Hives</Link>
      </div>
    );
  }

  const initial: InspectionFormData | undefined = existing ? inspectionToForm(existing) : undefined;

  return (
    <div className="animate-fade-in">
      <Link to="/inspections" className="text-xs text-stone-400 hover:text-stone-600 mb-2 inline-block">← Inspections</Link>
      <h1 className="text-xl font-bold text-stone-800 mb-1">
        {existing ? 'Edit Inspection' : 'New Inspection'}
      </h1>
      {hive && <p className="text-sm text-stone-500 mb-4">{hive.name}</p>}

      <InspectionForm
        hiveId={existing?.hiveId ?? hiveId}
        initial={initial}
        onSubmit={(data) => {
          const fullData = { ...data, date: new Date(data.date).toISOString() };
          if (existing) {
            updateInspection(existing.id, fullData);
            updateHive(fullData.hiveId, { healthStatus: fullData.healthStatus });
            navigate(`/inspections/${existing.id}`);
          } else {
            const insp = addInspection(fullData);
            updateHive(fullData.hiveId, { healthStatus: fullData.healthStatus });
            navigate(`/inspections/${insp.id}`);
          }
        }}
        onCancel={() => navigate(-1)}
        submitLabel={existing ? 'Update Inspection' : 'Save Inspection'}
      />
    </div>
  );
}