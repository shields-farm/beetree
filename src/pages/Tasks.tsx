import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check, Trash2, Calendar } from 'lucide-react';
import { formatDistanceToNow, isPast, isToday } from 'date-fns';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import type { TaskPriority } from '../types';

export function Tasks() {
  const { tasks, hives, apiaries, addTask, toggleTask, deleteTask } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [hiveId, setHiveId] = useState('');
  const [apiaryId, setApiaryId] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'done' | 'overdue'>('open');

  const sorted = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  });

  const filtered = sorted.filter((t) => {
    if (filter === 'open') return !t.completed;
    if (filter === 'done') return t.completed;
    if (filter === 'overdue') return !t.completed && t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate));
    return true;
  });

  const handleAdd = () => {
    if (!title.trim()) return;
    addTask({
      title: title.trim(),
      description: desc.trim() || undefined,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      priority,
      hiveId: hiveId || undefined,
      apiaryId: apiaryId || undefined,
      completed: false,
    });
    setTitle('');
    setDesc('');
    setDueDate('');
    setHiveId('');
    setApiaryId('');
    setPriority('medium');
    setShowAdd(false);
  };

  const priorityColor: Record<TaskPriority, string> = {
    high: 'bg-red-500',
    medium: 'bg-amber-500',
    low: 'bg-stone-400',
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.filter((t) => !t.completed).length} open`}
        action={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600"
            title="Add task"
          >
            <Plus size={22} />
          </button>
        }
      />

      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {(['open', 'overdue', 'done', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize whitespace-nowrap transition-colors ${
              filter === f ? 'bg-honey-500 text-white' : 'bg-white border border-stone-200 text-stone-600'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm" />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm resize-y" />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={dueDate ? new Date(dueDate).toISOString().slice(0, 10) : ''} onChange={(e) => setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '')} className="rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm" />
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm appearance-none">
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
            </div>
            <select value={apiaryId} onChange={(e) => { setApiaryId(e.target.value); setHiveId(''); }} className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm appearance-none">
              <option value="">No apiary</option>
              {apiaries.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select value={hiveId} onChange={(e) => setHiveId(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm appearance-none">
              <option value="">No hive</option>
              {hives.filter((h) => !apiaryId || h.apiaryId === apiaryId).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <button onClick={handleAdd} disabled={!title.trim()} className="w-full py-2.5 rounded-xl bg-honey-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-honey-600">
              Add Task
            </button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((t) => {
          const hive = hives.find((h) => h.id === t.hiveId);
          const apiary = apiaries.find((a) => a.id === t.apiaryId);
          const overdue = !t.completed && t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate));
          return (
            <Card key={t.id} className="flex items-start gap-3" pad>
              <button
                onClick={() => toggleTask(t.id)}
                className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                  t.completed ? 'bg-green-500 border-green-500' : 'border-stone-300 hover:border-honey-400'
                }`}
              >
                {t.completed && <Check size={14} className="text-white" strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${t.completed ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{t.title}</div>
                {t.description && <p className="text-xs text-stone-400 mt-0.5">{t.description}</p>}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${priorityColor[t.priority]}`} />
                  {t.dueDate && (
                    <span className={`text-[10px] flex items-center gap-0.5 ${overdue ? 'text-red-500' : 'text-stone-400'}`}>
                      <Calendar size={10} /> {isToday(new Date(t.dueDate)) ? 'Today' : formatDistanceToNow(new Date(t.dueDate), { addSuffix: true })}
                    </span>
                  )}
                  {hive && <Link to={`/hives/${hive.id}`} className="text-[10px] text-honey-600 hover:underline">{hive.name}</Link>}
                  {apiary && !hive && <span className="text-[10px] text-stone-400">{apiary.name}</span>}
                </div>
              </div>
              <button onClick={() => deleteTask(t.id)} className="text-stone-300 hover:text-red-500 p-1 shrink-0">
                <Trash2 size={15} />
              </button>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-stone-400 py-8">No tasks in this view.</p>
        )}
      </div>
    </div>
  );
}