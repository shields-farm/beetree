import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bug,
  Camera,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  Save,
  History,
  ChevronLeft,
  Check,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { useStore } from '../store/useStore';

const API_BASE = 'http://localhost:3001';

interface VarroaCount {
  miteCount: number;
  confidence: 'high' | 'medium' | 'low';
  boardArea: string;
  otherDebris: string;
  infestationLevel: 'low' | 'moderate' | 'high' | 'severe';
  recommendation: string;
  naturalDropPerDay: number;
}

interface VarroaHistoryEntry {
  inspectionId: string;
  hiveId: string;
  date: string;
  miteCount: number;
  note: string;
  healthStatus: string;
}

const INFESTATION_META: Record<VarroaCount['infestationLevel'], { label: string; bg: string; text: string; ring: string }> = {
  low: { label: 'Low', bg: 'bg-green-100', text: 'text-green-800', ring: 'ring-green-300' },
  moderate: { label: 'Moderate', bg: 'bg-amber-100', text: 'text-amber-800', ring: 'ring-amber-300' },
  high: { label: 'High', bg: 'bg-orange-100', text: 'text-orange-800', ring: 'ring-orange-300' },
  severe: { label: 'Severe', bg: 'bg-red-100', text: 'text-red-800', ring: 'ring-red-300' },
};

const CONFIDENCE_META: Record<VarroaCount['confidence'], { label: string; color: string }> = {
  high: { label: 'High confidence', color: 'text-green-600' },
  medium: { label: 'Medium confidence', color: 'text-amber-600' },
  low: { label: 'Low confidence', color: 'text-red-600' },
};

export function VarroaCounter() {
  const { hives } = useStore();
  const navigate = useNavigate();

  const [image, setImage] = useState<string | null>(null);
  const [hiveId, setHiveId] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<VarroaCount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<VarroaHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const photoCaptureRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Default hive selection
  useEffect(() => {
    if (!hiveId && hives.length > 0) setHiveId(hives[0].id);
  }, [hives, hiveId]);

  // Load history when hive changes
  useEffect(() => {
    if (!hiveId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const resp = await fetch(API_BASE + '/api/varroa/history/' + hiveId);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = (await resp.json()) as VarroaHistoryEntry[];
        if (!cancelled) setHistory(data);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hiveId]);

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setResult(null);
      setSaved(false);
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const analyze = async () => {
    if (!image || !hiveId) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSaved(false);
    try {
      const resp = await fetch(API_BASE + '/api/vision/varroa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, hiveId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status }));
        throw new Error(err.error || 'HTTP ' + resp.status);
      }
      const data = (await resp.json()) as { count: VarroaCount };
      setResult(data.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveReading = async () => {
    if (!result || !hiveId || !image) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(API_BASE + '/api/vision/varroa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          hiveId,
          miteCount: result.miteCount,
          date: new Date().toISOString(),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status }));
        throw new Error(err.error || 'HTTP ' + resp.status);
      }
      setSaved(true);
      // Refresh history
      const histResp = await fetch(API_BASE + '/api/varroa/history/' + hiveId);
      if (histResp.ok) {
        const data = (await histResp.json()) as VarroaHistoryEntry[];
        setHistory(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const maxHistoryCount = Math.max(1, ...history.map((h) => h.miteCount));

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Varroa Counter"
        subtitle="AI-powered sticky board mite counting"
        action={
          <button
            onClick={() => navigate(-1)}
            className="lg:hidden flex items-center gap-1 text-sm text-stone-500"
          >
            <ChevronLeft size={18} /> Back
          </button>
        }
      />

      {/* Hive selector */}
      <Card>
        <label className="block text-sm font-medium text-stone-700 mb-2">Hive</label>
        <select
          value={hiveId}
          onChange={(e) => setHiveId(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-honey-300"
        >
          {hives.length === 0 && <option value="">No hives available</option>}
          {hives.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </Card>

      {/* Camera capture */}
      {!image && (
        <Card>
          <div className="text-center py-6">
            <Bug size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-sm text-stone-500 mb-4">
              Take a photo of your varroa sticky board and the AI will count the mites for you.
            </p>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              <button
                onClick={() => photoCaptureRef.current?.click()}
                className="w-full py-3 rounded-xl bg-honey-500 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-honey-600"
              >
                <Camera size={20} /> Take Photo
              </button>
              <button
                onClick={() => photoInputRef.current?.click()}
                className="w-full py-2.5 rounded-xl bg-stone-50 border border-stone-200 text-stone-600 text-sm flex items-center justify-center gap-2 hover:bg-stone-100"
              >
                <ImageIcon size={16} /> Choose from Gallery
              </button>
            </div>
            <input ref={photoCaptureRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoFile} className="hidden" />
            <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoFile} className="hidden" />
          </div>
        </Card>
      )}

      {/* Image preview + analyze */}
      {image && (
        <Card>
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden">
              <img src={image} alt="Sticky board" className="w-full max-h-80 object-contain bg-stone-900" />
              <button
                onClick={() => { setImage(null); setResult(null); setSaved(false); setError(null); }}
                className="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs font-medium hover:bg-black/80"
              >
                Retake
              </button>
            </div>
            {!result && !analyzing && (
              <button
                onClick={analyze}
                disabled={!hiveId}
                className="w-full py-3 rounded-xl bg-honey-500 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-honey-600 disabled:opacity-50"
              >
                <Bug size={18} /> Count Mites with AI
              </button>
            )}
            {analyzing && (
              <div className="flex items-center justify-center gap-2 py-3 text-honey-600 text-sm">
                <Loader2 size={20} className="animate-spin" /> Analyzing sticky board…
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Analysis Error</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card>
          <div className="space-y-4">
            {/* Mite count hero */}
            <div className="text-center py-4">
              <div className="text-6xl font-bold text-stone-800">{result.miteCount}</div>
              <div className="text-sm text-stone-500 mt-1">Varroa mites detected</div>
              <div className={'inline-flex items-center gap-1.5 mt-3 px-4 py-1.5 rounded-full text-sm font-semibold ' + INFESTATION_META[result.infestationLevel].bg + ' ' + INFESTATION_META[result.infestationLevel].text}>
                <span className={'w-2 h-2 rounded-full ' + INFESTATION_META[result.infestationLevel].bg.replace('100', '500')} />
                {INFESTATION_META[result.infestationLevel].label} infestation
              </div>
            </div>

            {/* Confidence */}
            <div className="flex items-center justify-center gap-1.5 text-xs">
              <span className={'font-medium ' + CONFIDENCE_META[result.confidence].color}>
                {CONFIDENCE_META[result.confidence].label}
              </span>
              <span className="text-stone-300">·</span>
              <span className="text-stone-500">~{result.naturalDropPerDay} mites/day</span>
            </div>

            {/* Recommendation */}
            <div className="rounded-xl bg-stone-50 border border-stone-100 p-3">
              <p className="text-xs font-medium text-stone-500 mb-1">Recommendation</p>
              <p className="text-sm text-stone-700">{result.recommendation}</p>
            </div>

            {/* Details */}
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-medium text-stone-500">Board area: </span>
                <span className="text-stone-700">{result.boardArea}</span>
              </div>
              <div>
                <span className="font-medium text-stone-500">Other debris: </span>
                <span className="text-stone-700">{result.otherDebris}</span>
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={saveReading}
              disabled={saving || saved}
              className={'w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors ' + (saved ? 'bg-green-500 text-white' : 'bg-honey-500 text-white hover:bg-honey-600 disabled:opacity-50')}
            >
              {saved ? (<><Check size={18} /> Saved to Inspection</>) : (<><Save size={18} /> {saving ? 'Saving…' : 'Save Reading'}</>)}
            </button>
          </div>
        </Card>
      )}

      {/* History chart */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <History size={18} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-stone-800">Mite Count History</h3>
        </div>
        {historyLoading ? (
          <div className="flex items-center justify-center py-6 text-stone-400 text-sm">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-6">No varroa readings recorded for this hive yet.</p>
        ) : (
          <div className="space-y-2">
            {/* Simple bar chart */}
            <div className="flex items-end gap-2 h-32 px-1">
              {history.slice(0, 12).reverse().map((h) => {
                const heightPct = Math.max(4, (h.miteCount / maxHistoryCount) * 100);
                const level = h.miteCount < 3 ? 'bg-green-400' : h.miteCount <= 10 ? 'bg-amber-400' : h.miteCount <= 30 ? 'bg-orange-400' : 'bg-red-400';
                return (
                  <div key={h.inspectionId} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="text-[9px] text-stone-400">{h.miteCount}</div>
                    <div className={'w-full rounded-t ' + level} style={{ height: heightPct + '%' }} />
                    <div className="text-[8px] text-stone-400 whitespace-nowrap">
                      {new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Threshold legend */}
            <div className="flex items-center gap-3 text-[10px] text-stone-400 pt-2 border-t border-stone-100">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-400" /> &lt;3</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-400" /> 3-10</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-400" /> 10-30</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-400" /> &gt;30</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}