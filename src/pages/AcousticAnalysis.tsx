import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Mic,
  Square,
  Loader2,
  AlertTriangle,
  Save,
  Clock,
  History,
  Lightbulb,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

interface AcousticAnalysis {
  hiveId: string;
  interpretation: 'queenright' | 'queenless' | 'swarm-preparation' | 'stressed' | 'normal' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  frequency: string;
  pattern: string;
  notes: string;
  recommendations: string[];
}

interface Hive {
  id: string;
  name: string;
}

interface AcousticHistoryEntry {
  inspectionId: string;
  hiveId: string;
  date: string;
  note: string;
  healthStatus: string;
  notes: string;
}

const INTERP_META: Record<AcousticAnalysis['interpretation'], { label: string; bg: string; text: string }> = {
  queenright: { label: 'Queenright', bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800' },
  queenless: { label: 'Queenless', bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800' },
  'swarm-preparation': { label: 'Swarm Preparation', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800' },
  stressed: { label: 'Stressed', bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-800' },
  normal: { label: 'Normal', bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800' },
  unknown: { label: 'Unknown', bg: 'bg-stone-100 dark:bg-stone-800', text: 'text-stone-600 dark:text-stone-300' },
};

const CONF_META: Record<AcousticAnalysis['confidence'], { label: string; color: string }> = {
  high: { label: 'High confidence', color: 'text-green-600 dark:text-green-400' },
  medium: { label: 'Medium confidence', color: 'text-amber-600 dark:text-amber-400' },
  low: { label: 'Low confidence', color: 'text-stone-500 dark:text-stone-400' },
};

export function AcousticAnalysis() {
  const [hives, setHives] = useState<Hive[]>([]);
  const [selectedHiveId, setSelectedHiveId] = useState('');
  const [description, setDescription] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBase64, setAudioBase64] = useState<string | undefined>(undefined);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AcousticAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<AcousticHistoryEntry[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    apiFetch(API_BASE + '/api/hives')
      .then((r) => r.json())
      .then((data: Hive[]) => {
        setHives(data);
        if (data.length > 0 && !selectedHiveId) setSelectedHiveId(data[0].id);
      })
      .catch((e) => setError('Failed to load hives: ' + (e instanceof Error ? e.message : String(e))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedHiveId) return;
    apiFetch(API_BASE + '/api/acoustics/history/' + selectedHiveId)
      .then((r) => r.json())
      .then((data: AcousticHistoryEntry[]) => setHistory(data))
      .catch(() => setHistory([]));
  }, [selectedHiveId]);

  function startRecording() {
    setSavedMsg(null);
    setAnalysis(null);
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const mr = new MediaRecorder(stream);
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            setAudioBase64(reader.result as string);
          };
          reader.readAsDataURL(blob);
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
        };
        mr.start();
        setRecording(true);
        setRecordSeconds(0);
        timerRef.current = setInterval(() => {
          setRecordSeconds((s) => s + 1);
        }, 1000);
      })
      .catch((e) => {
        setError('Microphone access denied or unavailable: ' + (e instanceof Error ? e.message : String(e)) + '. Use the text description instead.');
      });
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function handleAnalyze() {
    if (!selectedHiveId) {
      setError('Select a hive first.');
      return;
    }
    if (!description.trim() && !audioBase64) {
      setError('Either record audio or type a description of the sound.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setSavedMsg(null);
    try {
      const body: Record<string, unknown> = { hiveId: selectedHiveId };
      if (description.trim()) body.description = description.trim();
      if (audioBase64) {
        body.audio = audioBase64;
        body.duration = recordSeconds;
      }
      const resp = await apiFetch(API_BASE + '/api/acoustics/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || statusToMessage(resp.status));
      }
      const data = (await resp.json()) as AcousticAnalysis;
      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!analysis || !selectedHiveId) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const resp = await apiFetch(API_BASE + '/api/acoustics/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiveId: selectedHiveId, analysis }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || statusToMessage(resp.status));
      }
      setSavedMsg('Saved to inspection successfully.');
      // Refresh history
      const histResp = await apiFetch(API_BASE + '/api/acoustics/history/' + selectedHiveId);
      if (histResp.ok) {
        const histData = (await histResp.json()) as AcousticHistoryEntry[];
        setHistory(histData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Hive Acoustics" subtitle="Detect queenlessness, swarms & stress from sound" />

      {/* Hive selector */}
      <Card>
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">Hive</label>
        <select
          className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm"
          value={selectedHiveId}
          onChange={(e) => { setSelectedHiveId(e.target.value); setAnalysis(null); setSavedMsg(null); }}
        >
          {hives.length === 0 && <option value="">No hives available</option>}
          {hives.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </Card>

      {/* Recording */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3 flex items-center gap-2">
          <AudioLines size={16} className="text-honey-500" /> Record Audio
        </h3>
        <div className="flex items-center gap-3">
          {!recording ? (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-honey-500 text-white text-sm font-medium hover:bg-honey-600 transition-colors"
            >
              <Mic size={18} /> Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
            >
              <Square size={18} /> Stop
            </button>
          )}
          {recording && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <Clock size={16} />
              <span>{recordSeconds}s</span>
            </div>
          )}
          {!recording && recordSeconds > 0 && audioBase64 && (
            <span className="text-xs text-green-600 dark:text-green-400">Recorded {recordSeconds}s ✓</span>
          )}
        </div>
        {audioBase64 && !recording && (
          <audio controls src={audioBase64} className="mt-3 w-full" style={{ height: 36 }} />
        )}
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">
          Place your phone microphone near the hive entrance. Record 5-15 seconds for best results.
        </p>
      </Card>

      {/* Text description */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">Or describe what you hear</h3>
        <textarea
          className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm min-h-[80px]"
          placeholder="e.g. The hive sounds like a steady low hum, calm and continuous."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
          Tip: describe the pitch, volume, and pattern. "Queenless roar", "agitated buzz", "calm hum".
        </p>
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

      {/* Analyze button */}
      <button
        onClick={handleAnalyze}
        disabled={analyzing || !selectedHiveId || (!description.trim() && !audioBase64)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {analyzing ? <Loader2 size={18} className="animate-spin" /> : <AudioLines size={18} />}
        {analyzing ? 'Analyzing…' : 'Analyze'}
      </button>

      {/* Results */}
      {analysis && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Analysis Results</h3>
            <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + INTERP_META[analysis.interpretation].bg + ' ' + INTERP_META[analysis.interpretation].text}>
              {INTERP_META[analysis.interpretation].label}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-stone-400 dark:text-stone-500 w-24">Confidence:</span>
              <span className={CONF_META[analysis.confidence].color}>{CONF_META[analysis.confidence].label}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-stone-400 dark:text-stone-500 w-24 shrink-0">Frequency:</span>
              <span className="text-stone-700 dark:text-stone-200">{analysis.frequency}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-stone-400 dark:text-stone-500 w-24 shrink-0">Pattern:</span>
              <span className="text-stone-700 dark:text-stone-200">{analysis.pattern}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-stone-400 dark:text-stone-500 w-24 shrink-0">Notes:</span>
              <span className="text-stone-700 dark:text-stone-200">{analysis.notes}</span>
            </div>
          </div>
          {analysis.recommendations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
              <h4 className="text-xs font-semibold text-stone-600 dark:text-stone-300 mb-2 flex items-center gap-1.5">
                <Lightbulb size={14} className="text-amber-500" /> Recommendations
              </h4>
              <div className="space-y-1.5">
                {analysis.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-honey-400" />
                    <span className="text-sm text-stone-700 dark:text-stone-200">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-honey-500 text-white text-sm font-medium hover:bg-honey-600 transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : 'Save to Inspection'}
          </button>
          {savedMsg && (
            <p className="mt-2 text-xs text-green-600 dark:text-green-400 text-center">{savedMsg}</p>
          )}
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
            <History size={16} className="text-stone-400 dark:text-stone-500" /> Past Acoustic Checks
          </h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    {new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">Health: {h.healthStatus}</span>
                </div>
                <p className="text-sm text-stone-700 dark:text-stone-200">{h.note}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}