import { useEffect, useState } from 'react';
import {
  Layers,
  Loader2,
  AlertTriangle,
  Camera,
  X,
  Upload,
  Lightbulb,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

import { API_BASE, apiFetch } from '../lib/apiBase';

interface Hive {
  id: string;
  name: string;
}

interface FrameAnalysis {
  broodPattern: string;
  queenSpotted: boolean;
  queenLocation: string;
  broodRatio: number;
  honeyRatio: number;
  pollenRatio: number;
  cappedBroodPresent: boolean;
  eggsVisible: boolean;
  larvaeVisible: boolean;
  diseases: { type: string; confidence: string; note: string }[];
  pests: { type: string; count?: number; note: string }[];
  overallAssessment: string;
  recommendations: string[];
  concerns: { type: string; note: string }[];
}

interface FrameReconstruction {
  hiveId: string;
  photoCount: number;
  coverage: number;
  combinedAnalysis: {
    totalBrood: number;
    totalHoney: number;
    totalPollen: number;
    empty: number;
    healthSummary: string;
    perPhoto: { index: number; analysis: FrameAnalysis }[];
  };
  recommendations: string[];
}

function pct(ratio: number): string {
  return Math.round(ratio * 100) + '%';
}

export function ColonyMap() {
  const [hives, setHives] = useState<Hive[]>([]);
  const [selectedHiveId, setSelectedHiveId] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FrameReconstruction | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<number | null>(null);

  useEffect(() => {
    apiFetch(API_BASE + '/api/hives')
      .then((r) => r.json())
      .then((data: Hive[]) => {
        setHives(data);
        if (data.length > 0) setSelectedHiveId(data[0].id);
      })
      .catch((e) => setError('Failed to load hives: ' + (e instanceof Error ? e.message : String(e))));
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const arr = Array.from(files);
    const newImages: string[] = [];
    for (const file of arr) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      newImages.push(dataUrl);
    }
    setImages((prev) => [...prev, ...newImages]);
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleReconstruct() {
    if (!selectedHiveId) {
      setError('Select a hive first.');
      return;
    }
    if (images.length === 0) {
      setError('Upload at least one frame photo.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/vision/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, hiveId: selectedHiveId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + resp.status);
      }
      const data = (await resp.json()) as FrameReconstruction;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconstruction failed');
    } finally {
      setAnalyzing(false);
    }
  }

  // Stacked bar data
  const brood = result ? result.combinedAnalysis.totalBrood : 0;
  const honey = result ? result.combinedAnalysis.totalHoney : 0;
  const pollen = result ? result.combinedAnalysis.totalPollen : 0;
  const empty = result ? result.combinedAnalysis.empty : 0;
  const total = brood + honey + pollen + empty || 1;

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Colony Map" subtitle="Reconstruct colony health from multiple frame photos" />

      {/* Hive selector */}
      <Card>
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">Hive</label>
        <select
          className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm"
          value={selectedHiveId}
          onChange={(e) => { setSelectedHiveId(e.target.value); setResult(null); }}
        >
          {hives.length === 0 && <option value="">No hives available</option>}
          {hives.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </Card>

      {/* Photo upload */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3 flex items-center gap-2">
          <Camera size={16} className="text-honey-500" /> Frame Photos ({images.length})
        </h3>
        <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 text-sm font-medium cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800 w-fit">
          <Upload size={18} className="text-stone-500 dark:text-stone-400" /> Add Photos
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload} />
        </label>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">
          Upload photos from both sides of multiple frames for best coverage.
        </p>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img src={img} alt={'frame ' + i} className="w-20 h-20 rounded-lg object-cover border border-stone-200 dark:border-stone-800" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                >
                  <X size={12} />
                </button>
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                  #{i + 1}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {error && (
        <Card>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Error</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Reconstruct button */}
      <button
        onClick={handleReconstruct}
        disabled={analyzing || !selectedHiveId || images.length === 0}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Layers size={18} />}
        {analyzing ? 'Reconstructing…' : 'Reconstruct Colony'}
      </button>

      {/* Results */}
      {result && (
        <>
          {/* Health summary */}
          <Card>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
              <Layers size={16} className="text-honey-500" /> Colony Health Summary
            </h3>
            <p className="text-sm text-stone-700 dark:text-stone-200 leading-relaxed">{result.combinedAnalysis.healthSummary}</p>
            <div className="mt-3 flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
              <span>{result.photoCount} photos</span>
              <span>Coverage: {pct(result.coverage)}</span>
            </div>
          </Card>

          {/* Stacked bar chart */}
          <Card>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Combined Coverage</h3>
            <div className="h-8 rounded-lg overflow-hidden flex">
              <div className="bg-amber-600 flex items-center justify-center" style={{ width: (brood / total) * 100 + '%' }} title={'Brood: ' + pct(brood)}>
                {brood / total > 0.1 && <span className="text-white text-[11px] font-medium">Brood {pct(brood)}</span>}
              </div>
              <div className="bg-yellow-400 flex items-center justify-center" style={{ width: (honey / total) * 100 + '%' }} title={'Honey: ' + pct(honey)}>
                {honey / total > 0.1 && <span className="text-stone-700 dark:text-stone-200 text-[11px] font-medium">Honey {pct(honey)}</span>}
              </div>
              <div className="bg-orange-400 flex items-center justify-center" style={{ width: (pollen / total) * 100 + '%' }} title={'Pollen: ' + pct(pollen)}>
                {pollen / total > 0.1 && <span className="text-stone-700 dark:text-stone-200 text-[11px] font-medium">Pollen {pct(pollen)}</span>}
              </div>
              <div className="bg-stone-200 dark:bg-stone-700 flex items-center justify-center" style={{ width: (empty / total) * 100 + '%' }} title={'Empty: ' + pct(empty)}>
                {empty / total > 0.1 && <span className="text-stone-600 dark:text-stone-300 text-[11px] font-medium">Empty {pct(empty)}</span>}
              </div>
            </div>
            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-600" /> Brood {pct(brood)}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-400" /> Honey {pct(honey)}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-400" /> Pollen {pct(pollen)}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-stone-200 dark:bg-stone-700" /> Empty {pct(empty)}</span>
            </div>
          </Card>

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
                <Lightbulb size={16} className="text-amber-500" /> Recommendations
              </h3>
              <div className="space-y-1.5">
                {result.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-honey-400" />
                    <span className="text-sm text-stone-700 dark:text-stone-200">{r}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Per-photo breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">Per-Photo Breakdown</h3>
            <div className="space-y-2">
              {result.combinedAnalysis.perPhoto.map((pp) => {
                const a = pp.analysis;
                const expanded = expandedPhoto === pp.index;
                return (
                  <Card key={pp.index}>
                    <button
                      onClick={() => setExpandedPhoto(expanded ? null : pp.index)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <div className="flex items-center gap-2">
                        {expanded ? <ChevronDown size={16} className="text-stone-400 dark:text-stone-500" /> : <ChevronRight size={16} className="text-stone-400 dark:text-stone-500" />}
                        <span className="font-medium text-sm text-stone-800 dark:text-stone-100">Photo #{pp.index + 1}</span>
                        <span className="text-xs text-stone-400 dark:text-stone-500 capitalize">{a.broodPattern} brood</span>
                        {a.queenSpotted && <span className="text-xs text-honey-600 dark:text-honey-400 font-medium">Queen ✓</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
                        <span>Brood {pct(a.broodRatio)}</span>
                        <span>Honey {pct(a.honeyRatio)}</span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 space-y-2 text-sm">
                        <p className="text-stone-700 dark:text-stone-200">{a.overallAssessment}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-stone-500 dark:text-stone-400">
                          <span>Pollen: {pct(a.pollenRatio)}</span>
                          <span>Capped brood: {a.cappedBroodPresent ? 'Yes' : 'No'}</span>
                          <span>Eggs: {a.eggsVisible ? 'Yes' : 'No'}</span>
                          <span>Larvae: {a.larvaeVisible ? 'Yes' : 'No'}</span>
                        </div>
                        {a.queenSpotted && (
                          <p className="text-xs text-honey-700 dark:text-honey-300">Queen location: {a.queenLocation}</p>
                        )}
                        {a.diseases.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Diseases:</p>
                            {a.diseases.map((d, i) => (
                              <p key={i} className="text-xs text-stone-600 dark:text-stone-300">{d.type} ({d.confidence}): {d.note}</p>
                            ))}
                          </div>
                        )}
                        {a.pests.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Pests:</p>
                            {a.pests.map((p, i) => (
                              <p key={i} className="text-xs text-stone-600 dark:text-stone-300">{p.type}{p.count != null ? ' (' + p.count + ')' : ''}: {p.note}</p>
                            ))}
                          </div>
                        )}
                        {a.recommendations.length > 0 && (
                          <div className="pt-1">
                            <p className="text-xs font-semibold text-stone-600 dark:text-stone-300">Recommendations:</p>
                            <ul className="text-xs text-stone-600 dark:text-stone-300 ml-3 list-disc">
                              {a.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}