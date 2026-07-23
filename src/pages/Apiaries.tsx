import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, MapPin, Boxes, Trash2, Pencil, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

export function Apiaries() {
  const { apiaries, hives, addApiary, deleteApiary } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const handleAdd = () => {
    if (!name.trim()) return;
    addApiary({ name: name.trim(), address: address.trim() || undefined, notes: notes.trim() || undefined });
    setName('');
    setAddress('');
    setNotes('');
    setShowAdd(false);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Apiaries"
        subtitle={`${apiaries.length} location${apiaries.length !== 1 ? 's' : ''}`}
        action={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600 transition-colors"
            title="Add apiary"
          >
            <Plus size={22} />
          </button>
        }
      />

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">New Apiary</h3>
            <button onClick={() => setShowAdd(false)} className="text-stone-400 dark:text-stone-500"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apiary name"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address (optional)"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm resize-y"
            />
            <button
              onClick={handleAdd}
              disabled={!name.trim()}
              className="w-full py-2.5 rounded-xl bg-honey-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-honey-600"
            >
              Add Apiary
            </button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {apiaries.map((a) => {
          const count = hives.filter((h) => h.apiaryId === a.id).length;
          return (
            <Card key={a.id} className="flex items-center gap-3" pad>
              <Link to={`/apiaries/${a.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <MapPin size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{a.name}</div>
                  <div className="text-xs text-stone-400 dark:text-stone-500 truncate flex items-center gap-1">
                    <Boxes size={12} /> {count} hive{count !== 1 ? 's' : ''}
                    {a.address && <span className="truncate">· {a.address}</span>}
                  </div>
                </div>
              </Link>
              <button
                onClick={() => {
                  if (confirm(`Delete apiary "${a.name}" and all its hives?`)) deleteApiary(a.id);
                }}
                className="text-stone-300 dark:text-stone-600 hover:text-red-500 p-1.5"
              >
                <Trash2 size={16} />
              </button>
            </Card>
          );
        })}
        {apiaries.length === 0 && !showAdd && (
          <p className="text-center text-sm text-stone-400 dark:text-stone-500 py-12">No apiaries yet. Tap + to add one.</p>
        )}
      </div>
    </div>
  );
}

export function ApiaryDetail({ id }: { id: string }) {
  const { apiaries, hives, updateApiary, deleteApiary } = useStore();
  const apiary = apiaries.find((a) => a.id === id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(apiary?.name ?? '');
  const [address, setAddress] = useState(apiary?.address ?? '');
  const [notes, setNotes] = useState(apiary?.notes ?? '');

  if (!apiary) {
    return (
      <div className="animate-fade-in">
        <p className="text-sm text-stone-400 dark:text-stone-500">Apiary not found.</p>
        <Link to="/apiaries" className="text-honey-600 dark:text-honey-400 text-sm underline mt-2 inline-block">Back to apiaries</Link>
      </div>
    );
  }

  const apiaryHives = hives.filter((h) => h.apiaryId === id);

  const save = () => {
    updateApiary(apiary.id, { name: name.trim() || apiary.name, address: address.trim() || undefined, notes: notes.trim() || undefined });
    setEditing(false);
  };

  return (
    <div className="animate-fade-in">
      <Link to="/apiaries" className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 mb-2 inline-block">← Apiaries</Link>
      <PageHeader
        title={apiary.name}
        subtitle={`${apiaryHives.length} hive${apiaryHives.length !== 1 ? 's' : ''}`}
        action={
          <button onClick={() => setEditing(!editing)} className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 flex items-center justify-center">
            <Pencil size={16} />
          </button>
        }
      />

      {editing && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm resize-y" />
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 text-sm">Cancel</button>
              <button onClick={save} className="flex-1 py-2 rounded-xl bg-honey-500 text-white text-sm font-medium">Save</button>
            </div>
            <button
              onClick={() => {
                if (confirm(`Delete "${apiary.name}" and all its hives?`)) {
                  deleteApiary(apiary.id);
                  window.location.hash = '#/apiaries';
                }
              }}
              className="w-full py-2 rounded-xl border border-red-200 text-red-600 dark:text-red-400 text-sm flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} /> Delete apiary
            </button>
          </div>
        </Card>
      )}

      {apiary.notes && !editing && (
        <Card className="mb-4">
          <p className="text-sm text-stone-600 dark:text-stone-300">{apiary.notes}</p>
          {apiary.address && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 flex items-center gap-1"><MapPin size={12} /> {apiary.address}</p>}
        </Card>
      )}

      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2 px-1">Hives</h3>
      <div className="space-y-3">
        {apiaryHives.map((h) => (
          <Card key={h.id} onClick={() => { window.location.hash = `#/hives/${h.id}` }} className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-400 flex items-center justify-center shrink-0">
              <Boxes size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{h.name}</div>
              <div className="text-xs text-stone-400 dark:text-stone-500 truncate">{h.boxes.length} box{h.boxes.length !== 1 ? 'es' : ''} · {h.healthStatus}</div>
            </div>
          </Card>
        ))}
        {apiaryHives.length === 0 && (
          <p className="text-center text-sm text-stone-400 dark:text-stone-500 py-8">
            No hives here yet. <Link to="/hives" className="text-honey-600 dark:text-honey-400 underline">Add one →</Link>
          </p>
        )}
      </div>
    </div>
  );
}