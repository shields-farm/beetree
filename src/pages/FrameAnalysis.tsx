import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  Upload,
  Loader2,
  AlertTriangle,
  Check,
  Crown,
  Bug,
  HeartPulse,
  ChevronRight,
  Sparkles,
  ClipboardCheck,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card, SectionCard } from '../components/Card';
import { useStore } from '../store/useStore';
import type { Hive } from '../types';

const API_BASE = 'http://localhost:3001';

// ─── Vision analysis types (mirror server/vision.ts) ──────────────────────────
interface FrameAnalysisDisease {
  type: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}
interface FrameAnalysisPest {
  type: string;
  count?: number;
  note: string;
}
interface FrameAnalysisConcern {
  type: string;
  note: string;
}
interface FrameAnalysis {
  broodPattern: 'solid' | 'spotty' | 'patchy' | 'none' | 'unknown';
  queenSpotted: boolean;
  queenLocation: string;
  broodRatio: number;
  honeyRatio: number;
  pollenRatio: number;
  cappedBroodPresent: boolean;
  eggsVisible: boolean;
  larvaeVisible: boolean;
  diseases: FrameAnalysisDisease[];
  pests: FrameAnalysisPest[];
  overallAssessment: string;
  recommendations: string[];
  concerns: FrameAnalysisConcern[];
}

// ─── Brood pattern display config ─────────────────────────────────────────────
const BROOD_PATTERN_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  solid: { label: 'Solid', color: 'text-green-700', bg: 'bg-green-100', icon: '✓' },
  spotty: { label: 'Spotty', color: 'text-orange-700', bg: 'bg-orange-100', icon: '!' },
  patchy: { label: 'Patchy', color: 'text-amber-700', bg: 'bg-amber-100', icon: '~' },
  none: { label: 'None', color: 'text-red-700', bg: 'bg-red-100', icon: '×' },
  unknown: { label: 'Unknown', color: 'text-stone-500', bg: 'bg-stone-100', icon: '?' },
};

const CONFIDENCE_META: Record<string, { label: string; bg: string; text: string }> = {
  high: { label: 'High', bg: 'bg-red-100', text: 'text-red-700' },
  medium: { label: 'Medium', bg: 'bg-amber-100', text: 'text-amber-700' },
  low: { label: 'Low', bg: 'bg-stone-100', text: 'text-stone-500' },
};

// ─── Ratio bar component ──────────────────────────────────────────────────────
function RatioBar({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-stone-700 flex items-center gap-1.5">
          <span>{icon}</span>
          {label}
        </span>
        <span className="text-xs font-semibold text-stone-500">{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden">
        <div
          className={'h-full rounded-full transition-all duration-500 ' + color}
          style={{ width: Math.max(pct, 2) + '%' }}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FrameAnalysisPage() {
  const { hives } = useStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [hiveId, setHiveId] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInspectionId, setCreatedInspectionId] = useState<string | null>(null);

  // Pre-select first hive
  useEffect(() => {
    if (!hiveId && hives.length > 0) setHiveId(hives[0].id);
  }, [hives, hiveId]);

  const reset = useCallback(() => {
    setImageDataUrl(null);
    setAnalysis(null);
    setAnalysisTimestamp(null);
    setError(null);
    setCreateError(null);
    setCreatedInspectionId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Image is too large (max 15MB).');
      return;
    }
    setError(null);
    setAnalysis(null);
    setCreatedInspectionId(null);
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
    };
    reader.onerror = () => setError('Failed to read image file.');
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!imageDataUrl) {
      setError('Please select or capture a photo first.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setCreatedInspectionId(null);
    try {
      const resp = await fetch(API_BASE + '/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageDataUrl, hiveId: hiveId || undefined }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || 'HTTP ' + resp.status);
      }
      const data = await resp.json() as { analysis: FrameAnalysis; timestamp: string };
      setAnalysis(data.analysis);
      setAnalysisTimestamp(data.timestamp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreateInspection = async () => {
    if (!imageDataUrl || !analysis) return;
    if (!hiveId) {
      setCreateError('Please select a hive.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const resp = await fetch(API_BASE + '/api/vision/analyze-and-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageDataUrl, hiveId }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || 'HTTP ' + resp.status);
      }
      const data = await resp.json() as { inspection: { id: string } };
      setCreatedInspectionId(data.inspection.id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create inspection.');
    } finally {
      setCreating(false);
    }
  };

  const selectedHive: Hive | undefined = hives.find((h) => h.id === hiveId);
  const broodMeta = analysis ? BROOD_PATTERN_META[analysis.broodPattern] ?? BROOD_PATTERN_META.unknown : null;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="AI Frame Analysis"
        subtitle="Snap a frame photo — AI identifies brood, queen, diseases & pests"
      />

      {/* Success banner after creating inspection */}
      {createdInspectionId && (
        <Card className="mb-4 bg-green-50 border-green-200">
          <div className="flex items-center gap-3">
            <Check size={22} className="text-green-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">Inspection created!</p>
              <p className="text-xs text-green-600">Saved to {selectedHive?.name ?? 'hive'} with AI analysis results.</p>
            </div>
            <button
              onClick={() => navigate('/inspections/' + createdInspectionId)}
              className="text-xs font-medium text-green-700 underline flex items-center gap-1"
            >
              View <ChevronRight size={14} />
            </button>
          </div>
        </Card>
      )}

      {/* Error banner */}
      {error && (
        <Card className="mb-4 bg-red-50 border-red-200">
          <div className="flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p>{error}</p>
              {error.includes('429') && (
                <p className="text-xs text-red-500 mt-1">The vision API is rate-limited. Wait a moment and try again.</p>
              )}
              {error.includes('SYNTHETIC_NEW_API_KEY') && (
                <p className="text-xs text-red-500 mt-1">Set the SYNTHETIC_NEW_API_KEY env var on the server.</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Photo capture / upload section */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Camera size={20} className="text-honey-600" />
          <h3 className="text-sm font-semibold text-stone-800">Frame Photo</h3>
        </div>

        {!imageDataUrl ? (
          <div
            className="border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center hover:border-honey-400 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-16 h-16 rounded-2xl bg-honey-50 flex items-center justify-center mx-auto mb-3">
              <Camera size={32} className="text-honey-500" />
            </div>
            <p className="text-sm font-medium text-stone-700">Tap to capture or upload</p>
            <p className="text-xs text-stone-400 mt-1">Take a clear photo of a single frame</p>
            <div className="flex items-center justify-center gap-1 mt-3 text-xs text-stone-400">
              <Upload size={14} />
              <span>JPG / PNG · max 15MB</span>
            </div>
          </div>
        ) : (
          <div className="relative">
            <img
              src={imageDataUrl}
              alt="Frame photo"
              className="w-full rounded-xl object-contain max-h-80 bg-stone-50"
            />
            <button
              onClick={() => setImageDataUrl(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
              title="Remove photo"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Hive selector */}
        <div className="mt-4">
          <label className="block">
            <span className="text-sm font-medium text-stone-700 block mb-1.5">Hive</span>
            <select
              value={hiveId}
              onChange={(e) => setHiveId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm appearance-none"
            >
              <option value="">— Select hive —</option>
              {hives.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Analyze button */}
        <button
          onClick={handleAnalyze}
          disabled={!imageDataUrl || analyzing}
          className="w-full mt-4 py-3 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {analyzing ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Analyzing frame…
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Analyze with AI
            </>
          )}
        </button>
      </Card>

      {/* Analysis results */}
      {analysis && broodMeta && (
        <div className="space-y-4">
          {/* Overall assessment */}
          <Card className="bg-gradient-to-br from-honey-50 to-amber-50 border-honey-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-honey-500 flex items-center justify-center shrink-0">
                <Sparkles size={20} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-stone-800 mb-1">AI Assessment</h3>
                <p className="text-sm text-stone-700 leading-relaxed">{analysis.overallAssessment}</p>
                {analysisTimestamp && (
                  <p className="text-[10px] text-stone-400 mt-2">
                    Analyzed {new Date(analysisTimestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Image + key findings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Brood pattern + queen */}
            <SectionCard title="Brood & Queen" icon={<HeartPulse size={16} className="text-honey-600" />}>
              {/* Brood pattern badge */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-stone-600">Brood pattern</span>
                <span className={'text-xs font-bold px-3 py-1 rounded-full ' + broodMeta.bg + ' ' + broodMeta.color}>
                  {broodMeta.icon} {broodMeta.label}
                </span>
              </div>

              {/* Queen spotted */}
              <div className="flex items-center justify-between py-2 border-t border-stone-100">
                <span className="text-sm text-stone-600 flex items-center gap-1.5">
                  <Crown size={15} className="text-amber-500" />
                  Queen spotted
                </span>
                {analysis.queenSpotted ? (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-700">
                    ✓ Yes
                  </span>
                ) : (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-stone-100 text-stone-500">
                    ✗ No
                  </span>
                )}
              </div>
              {analysis.queenSpotted && analysis.queenLocation && (
                <p className="text-xs text-stone-400 mt-1 pl-6">{analysis.queenLocation}</p>
              )}

              {/* Brood stages */}
              <div className="border-t border-stone-100 pt-2 mt-2 space-y-1.5">
                <CheckBadge label="Capped brood" present={analysis.cappedBroodPresent} />
                <CheckBadge label="Larvae visible" present={analysis.larvaeVisible} />
                <CheckBadge label="Eggs visible" present={analysis.eggsVisible} />
              </div>
            </SectionCard>

            {/* Ratios */}
            <SectionCard title="Frame Coverage" icon={<ImageIcon size={16} className="text-honey-600" />}>
              <RatioBar label="Brood" value={analysis.broodRatio} color="bg-amber-500" icon="🐝" />
              <RatioBar label="Honey" value={analysis.honeyRatio} color="bg-yellow-400" icon="🍯" />
              <RatioBar label="Pollen" value={analysis.pollenRatio} color="bg-orange-400" icon="🌼" />
            </SectionCard>
          </div>

          {/* Diseases */}
          {analysis.diseases.length > 0 && (
            <SectionCard title="Diseases Detected" icon={<AlertTriangle size={16} className="text-red-500" />}>
              <div className="space-y-2">
                {analysis.diseases.map((d, i) => {
                  const cm = CONFIDENCE_META[d.confidence] ?? CONFIDENCE_META.low;
                  return (
                    <div key={i} className="flex items-start gap-3 bg-red-50/50 rounded-lg p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-stone-800">{d.type}</span>
                          <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + cm.bg + ' ' + cm.text}>
                            {cm.label} confidence
                          </span>
                        </div>
                        {d.note && <p className="text-xs text-stone-500 mt-1">{d.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Pests */}
          {analysis.pests.length > 0 && (
            <SectionCard title="Pests Detected" icon={<Bug size={16} className="text-orange-500" />}>
              <div className="space-y-2">
                {analysis.pests.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 bg-orange-50/50 rounded-lg p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-stone-800">{p.type}</span>
                        {typeof p.count === 'number' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                            Count: {p.count}
                          </span>
                        )}
                      </div>
                      {p.note && <p className="text-xs text-stone-500 mt-1">{p.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Other concerns */}
          {analysis.concerns.length > 0 && (
            <SectionCard title="Other Concerns" icon={<AlertTriangle size={16} className="text-amber-500" />}>
              <div className="space-y-2">
                {analysis.concerns.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 bg-amber-50/50 rounded-lg p-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-stone-800">{c.type}</span>
                      {c.note && <p className="text-xs text-stone-500 mt-1">{c.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <SectionCard title="Recommendations" icon={<ClipboardCheck size={16} className="text-honey-600" />}>
              <ul className="space-y-2">
                {analysis.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full border-2 border-honey-400 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] text-honey-600 font-bold">{i + 1}</span>
                    </span>
                    <span className="text-sm text-stone-700">{r}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* Create inspection button */}
          <Card className="bg-stone-50">
            {createError && (
              <div className="mb-3 flex items-center gap-2 text-sm text-red-700">
                <AlertTriangle size={16} />
                {createError}
              </div>
            )}
            {createdInspectionId ? (
              <div className="flex gap-3">
                <button
                  onClick={() => navigate('/inspections/' + createdInspectionId)}
                  className="flex-1 py-3 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Check size={16} /> View Inspection
                </button>
                <button
                  onClick={reset}
                  className="flex-1 py-3 rounded-xl border border-stone-200 text-stone-600 font-medium text-sm hover:bg-stone-100"
                >
                  Analyze Another
                </button>
              </div>
            ) : (
              <button
                onClick={handleCreateInspection}
                disabled={creating || !hiveId}
                className="w-full py-3 rounded-xl bg-honey-500 text-white font-semibold text-sm hover:bg-honey-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Creating inspection…
                  </>
                ) : (
                  <>
                    <ClipboardCheck size={18} />
                    Create Inspection from Analysis
                  </>
                )}
              </button>
            )}
            {!hiveId && !createdInspectionId && (
              <p className="text-xs text-stone-400 text-center mt-2">Select a hive to create an inspection record.</p>
            )}
          </Card>
        </div>
      )}

      {/* Empty state hint */}
      {!imageDataUrl && !analyzing && !analysis && (
        <Card className="bg-stone-50/50">
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-2xl bg-honey-100 flex items-center justify-center mx-auto mb-3">
              <Sparkles size={24} className="text-honey-500" />
            </div>
            <h3 className="text-sm font-semibold text-stone-700">AI-Powered Frame Inspection</h3>
            <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
              Snap a photo of a pulled frame and the AI will identify brood patterns, spot the queen,
              detect diseases and pests, and estimate honey/brood/pollen ratios — then save it as an inspection.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Helper: check badge row ───────────────────────────────────────────────────
function CheckBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-stone-600">{label}</span>
      {present ? (
        <span className="flex items-center gap-1 text-xs font-medium text-green-700">
          <Check size={14} /> Yes
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs font-medium text-stone-400">
          <X size={14} /> No
        </span>
      )}
    </div>
  );
}