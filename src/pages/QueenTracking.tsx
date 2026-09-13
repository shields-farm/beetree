import { useEffect, useState } from 'react';
import {
  Crown,
  Loader2,
  AlertTriangle,
  Plus,
  ChevronLeft,
  Camera,
  X,
} from 'lucide-react';
import { EmbeddedPageHeader } from '../components/EmbeddedPageHeader';
import { Card } from '../components/Card';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

interface QueenRecord {
  id: string;
  hiveId: string;
  date: string;
  queenColor: string;
  queenYear: number;
  imageUrls: string[];
  notes: string;
  source: 'marked' | 'detected' | 'supersedure-suspected';
}

interface QueenStatus {
  hiveId: string;
  hiveName: string;
  currentQueen: QueenRecord | null;
  history: QueenRecord[];
  supersedureSuspected: boolean;
  daysSinceLastSeen: number | null;
  notes: string;
}

const QUEEN_COLORS = [
  { name: 'blue', bg: 'bg-blue-500', text: 'text-white' },
  { name: 'white', bg: 'bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700', text: 'text-stone-700 dark:text-stone-200' },
  { name: 'yellow', bg: 'bg-yellow-400', text: 'text-stone-700 dark:text-stone-200' },
  { name: 'red', bg: 'bg-red-500', text: 'text-white' },
  { name: 'green', bg: 'bg-green-500', text: 'text-white' },
  { name: 'unmarked', bg: 'bg-stone-200 dark:bg-stone-700', text: 'text-stone-600 dark:text-stone-300' },
];

function colorMeta(colorName: string) {
  return QUEEN_COLORS.find((c) => c.name === colorName) ?? QUEEN_COLORS[QUEEN_COLORS.length - 1];
}

function yearColor(year: number): string {
  const digit = year % 10;
  if (digit === 0 || digit === 5) return 'blue';
  if (digit === 1 || digit === 6) return 'white';
  if (digit === 2 || digit === 7) return 'yellow';
  if (digit === 3 || digit === 8) return 'red';
  if (digit === 4 || digit === 9) return 'green';
  return 'unknown';
}

export function QueenTracking() {
  const [statuses, setStatuses] = useState<QueenStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHive, setSelectedHive] = useState<QueenStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formColor, setFormColor] = useState('blue');
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formNotes, setFormNotes] = useState('');
  const [formSource, setFormSource] = useState<QueenRecord['source']>('marked');
  const [formImages, setFormImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  function loadAll() {
    setLoading(true);
    setError(null);
    apiFetch(API_BASE + '/api/queen/all')
      .then((r) => r.json())
      .then((data: QueenStatus[]) => {
        setStatuses(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load queen data');
        setLoading(false);
      });
  }

  function openHive(status: QueenStatus) {
    setSelectedHive(status);
  }

  function backToList() {
    setSelectedHive(null);
    setShowForm(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const arr = Array.from(files);
    const images: string[] = [];
    for (const file of arr) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      images.push(dataUrl);
    }
    setFormImages((prev) => [...prev, ...images]);
  }

  function removeImage(idx: number) {
    setFormImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!selectedHive) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/queen/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hiveId: selectedHive.hiveId,
          queenColor: formColor,
          queenYear: formYear,
          imageUrls: formImages,
          notes: formNotes,
          source: formSource,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || statusToMessage(resp.status));
      }
      // Refresh
      const allResp = await apiFetch(API_BASE + '/api/queen/all');
      const allData = (await allResp.json()) as QueenStatus[];
      setStatuses(allData);
      const updated = allData.find((s) => s.hiveId === selectedHive.hiveId);
      if (updated) setSelectedHive(updated);
      setShowForm(false);
      setFormNotes('');
      setFormImages([]);
      setFormColor('blue');
      setFormYear(new Date().getFullYear());
      setFormSource('marked');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-fade-in space-y-5">
        <EmbeddedPageHeader title="Queen Tracking" subtitle="Track marked queens & detect supersedure" />
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading queen data…
          </div>
        </Card>
      </div>
    );
  }

  if (error && statuses.length === 0) {
    return (
      <div className="animate-fade-in space-y-5">
        <EmbeddedPageHeader title="Queen Tracking" subtitle="Track marked queens & detect supersedure" />
        <Card>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Detail view
  if (selectedHive) {
    const recommendedColor = yearColor(formYear);
    return (
      <div className="animate-fade-in space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={backToList} className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700">
            <ChevronLeft size={20} className="text-stone-500 dark:text-stone-400" />
          </button>
          <EmbeddedPageHeader title={selectedHive.hiveName} subtitle="Queen history & tracking" />
        </div>

        {selectedHive.supersedureSuspected && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950 border border-amber-200 p-4 flex items-start gap-3 dark:border-amber-800">
            <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-amber-800 dark:text-amber-200">Supersedure Suspected</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{selectedHive.notes}</p>
            </div>
          </div>
        )}

        {/* Current queen */}
        <Card>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3 flex items-center gap-2">
            <Crown size={16} className="text-honey-500" /> Current Queen
          </h3>
          {selectedHive.currentQueen ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <span className={'w-6 h-6 rounded-full ' + colorMeta(selectedHive.currentQueen.queenColor).bg} />
                <span className="text-stone-700 dark:text-stone-200 capitalize">{selectedHive.currentQueen.queenColor}</span>
                <span className="text-stone-400 dark:text-stone-500">·</span>
                <span className="text-stone-700 dark:text-stone-200">{selectedHive.currentQueen.queenYear}</span>
              </div>
              <div className="text-stone-500 dark:text-stone-400 text-xs">
                Marked on {new Date(selectedHive.currentQueen.date).toLocaleDateString()}
              </div>
              {selectedHive.daysSinceLastSeen !== null && (
                <div className="text-stone-500 dark:text-stone-400 text-xs">
                  {selectedHive.daysSinceLastSeen} days since last sighting
                </div>
              )}
              {selectedHive.currentQueen.notes && (
                <div className="text-stone-600 dark:text-stone-300 text-sm mt-2">{selectedHive.currentQueen.notes}</div>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-400 dark:text-stone-500">No queen recorded yet.</p>
          )}
        </Card>

        {/* Record form */}
        {showForm ? (
          <Card>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Record Queen Sighting</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">Marking Color</label>
                <div className="flex flex-wrap gap-2">
                  {QUEEN_COLORS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => setFormColor(c.name)}
                      className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ' +
                        (formColor === c.name ? 'border-honey-500 ring-2 ring-honey-100' : 'border-stone-200 dark:border-stone-800')}
                    >
                      <span className={'w-4 h-4 rounded-full ' + c.bg} />
                      <span className="capitalize">{c.name}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                  Year {formYear} → recommended: <span className="capitalize font-medium">{recommendedColor}</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">Year Introduced</label>
                <input
                  type="number"
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm"
                  value={formYear}
                  onChange={(e) => setFormYear(Number(e.target.value) || new Date().getFullYear())}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">Source</label>
                <select
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm"
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value as QueenRecord['source'])}
                >
                  <option value="marked">Marked (I marked her)</option>
                  <option value="detected">Detected (spotted during inspection)</option>
                  <option value="supersedure-suspected">Supersedure suspected</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">Photos</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 dark:border-stone-800 text-xs font-medium cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800">
                    <Camera size={16} /> Upload
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
                {formImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formImages.map((img, i) => (
                      <div key={i} className="relative">
                        <img src={img} alt={'queen ' + i} className="w-16 h-16 rounded-lg object-cover" />
                        <button
                          onClick={() => removeImage(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">Notes</label>
                <textarea
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm min-h-[60px]"
                  placeholder="e.g. Marked with blue dot, good laying pattern observed."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-honey-500 text-white text-sm font-medium hover:bg-honey-600 disabled:opacity-40"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {saving ? 'Saving…' : 'Save Record'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Card>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-900"
          >
            <Plus size={18} /> Record Queen Sighting
          </button>
        )}

        {/* History timeline */}
        {selectedHive.history.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">Queen History</h3>
            <div className="space-y-2">
              {selectedHive.history.map((rec) => (
                <Card key={rec.id}>
                  <div className="flex items-start gap-3">
                    <span className={'shrink-0 w-6 h-6 rounded-full ' + colorMeta(rec.queenColor).bg} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-stone-800 dark:text-stone-100 capitalize">{rec.queenColor} · {rec.queenYear}</span>
                        <span className="text-xs text-stone-400 dark:text-stone-500">{new Date(rec.date).toLocaleDateString()}</span>
                      </div>
                      <span className="text-xs text-stone-500 dark:text-stone-400 capitalize">{rec.source.replace('-', ' ')}</span>
                      {rec.notes && <p className="text-sm text-stone-600 dark:text-stone-300 mt-1">{rec.notes}</p>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="animate-fade-in space-y-5">
      <EmbeddedPageHeader title="Queen Tracking" subtitle="Track marked queens & detect supersedure" />

      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {statuses.map((s) => (
          <Card key={s.hiveId} onClick={() => openHive(s)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {s.currentQueen ? (
                  <span className={'shrink-0 w-8 h-8 rounded-full flex items-center justify-center ' + colorMeta(s.currentQueen.queenColor).bg}>
                    <Crown size={16} className={colorMeta(s.currentQueen.queenColor).text} />
                  </span>
                ) : (
                  <span className="shrink-0 w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                    <Crown size={16} className="text-stone-300 dark:text-stone-600" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="font-medium text-stone-800 dark:text-stone-100 truncate">{s.hiveName}</div>
                  <div className="text-xs text-stone-400 dark:text-stone-500">
                    {s.currentQueen
                      ? 'Marked ' + s.currentQueen.queenColor + ' · ' + s.currentQueen.queenYear +
                        (s.daysSinceLastSeen !== null ? ' · ' + s.daysSinceLastSeen + 'd ago' : '')
                      : 'No queen recorded'}
                  </div>
                </div>
              </div>
              {s.supersedureSuspected && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                  Supersedure?
                </span>
              )}
            </div>
          </Card>
        ))}
        {statuses.length === 0 && (
          <Card>
            <p className="text-sm text-stone-400 dark:text-stone-500 text-center py-4">No hives found.</p>
          </Card>
        )}
      </div>
    </div>
  );
}