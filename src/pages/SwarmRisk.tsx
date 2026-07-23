import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wind,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { useStore } from '../store/useStore';

import { API_BASE, apiFetch, statusToMessage } from '../lib/apiBase';

interface SwarmFactor {
  factor: string;
  weight: number;
  detail: string;
}

interface SwarmRiskAssessment {
  hiveId: string;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'moderate' | 'high' | 'very-high';
  factors: SwarmFactor[];
  recommendations: string[];
  daysUntilLikelySwarm: number | null;
}

const RISK_META: Record<SwarmRiskAssessment['riskLevel'], { label: string; bg: string; text: string; bar: string; ring: string }> = {
  low: { label: 'Low', bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800', bar: 'bg-green-500', ring: 'ring-green-200' },
  moderate: { label: 'Moderate', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800', bar: 'bg-amber-500', ring: 'ring-amber-200' },
  high: { label: 'High', bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-800', bar: 'bg-orange-500', ring: 'ring-orange-200' },
  'very-high': { label: 'Very High', bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800', bar: 'bg-red-500', ring: 'ring-red-200' },
};

export function SwarmRisk() {
  const { hives } = useStore();
  const navigate = useNavigate();

  const [assessments, setAssessments] = useState<SwarmRiskAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHiveId, setSelectedHiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiFetch(API_BASE + '/api/swarm/risk');
        if (!resp.ok) throw new Error(statusToMessage(resp.status));
        const data = (await resp.json()) as SwarmRiskAssessment[];
        if (!cancelled) setAssessments(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load risk assessments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hiveName = (id: string) => hives.find((h) => h.id === id)?.name ?? id;
  const selected = assessments.find((a) => a.hiveId === selectedHiveId) ?? null;

  if (selected) {
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader
          title={hiveName(selected.hiveId)}
          subtitle="Swarm risk assessment"
          action={
            <button
              onClick={() => setSelectedHiveId(null)}
              className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400"
            >
              <ChevronLeft size={18} /> Back
            </button>
          }
        />

        {/* Score hero */}
        <Card>
          <div className="text-center py-4">
            <div className="text-5xl font-bold text-stone-800 dark:text-stone-100">{selected.riskScore}</div>
            <div className="text-sm text-stone-400 dark:text-stone-500 mt-1">/ 100 swarm risk score</div>
            <div className={'inline-flex items-center gap-1.5 mt-3 px-4 py-1.5 rounded-full text-sm font-semibold ' + RISK_META[selected.riskLevel].bg + ' ' + RISK_META[selected.riskLevel].text}>
              <AlertTriangle size={14} />
              {RISK_META[selected.riskLevel].label} risk
            </div>
            {/* Progress bar */}
            <div className="mt-4 h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div className={'h-full rounded-full ' + RISK_META[selected.riskLevel].bar} style={{ width: selected.riskScore + '%' }} />
            </div>
          </div>

          {/* Days until swarm */}
          {selected.daysUntilLikelySwarm != null && (
            <div className={'mt-2 rounded-xl p-3 flex items-center gap-3 ' + RISK_META[selected.riskLevel].bg}>
              <Clock size={20} className={RISK_META[selected.riskLevel].text} />
              <div>
                <div className={'text-sm font-semibold ' + RISK_META[selected.riskLevel].text}>
                  ~{selected.daysUntilLikelySwarm} day{selected.daysUntilLikelySwarm === 1 ? '' : 's'} until likely swarm
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  Based on queen cell stage at last inspection. Act now to prevent swarm.
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Factors */}
        <Card>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-stone-400 dark:text-stone-500" /> Risk Factors
          </h3>
          <div className="space-y-3">
            {selected.factors.map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={'shrink-0 mt-0.5 w-12 text-right text-xs font-bold ' + (f.weight > 0 ? 'text-orange-600' : f.weight < 0 ? 'text-green-600 dark:text-green-400' : 'text-stone-400 dark:text-stone-500')}>
                  {f.weight > 0 ? '+' : ''}{f.weight}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{f.factor}</div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recommendations checklist */}
        <Card>
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Recommendations</h3>
          <div className="space-y-2">
            {selected.recommendations.map((r, i) => (
              <label key={i} className="flex items-start gap-2.5 group cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-4 h-4 rounded accent-honey-500" />
                <span className="text-sm text-stone-700 dark:text-stone-200 group-hover:text-stone-900">{r}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Swarm Risk"
        subtitle="AI swarm probability for all hives"
        action={
          <button
            onClick={() => navigate(-1)}
            className="lg:hidden flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400"
          >
            <ChevronLeft size={18} /> Back
          </button>
        }
      />

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Calculating swarm risk for all hives…
          </div>
        </Card>
      )}

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

      {!loading && !error && assessments.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-6">No hives found. Add hives to see swarm risk assessments.</p>
        </Card>
      )}

      {/* Hive cards */}
      {!loading && assessments.length > 0 && (
        <div className="space-y-3">
          {assessments.map((a) => {
            const meta = RISK_META[a.riskLevel];
            return (
              <Card key={a.hiveId} onClick={() => setSelectedHiveId(a.hiveId)}>
                <div className="flex items-center gap-4">
                  {/* Score circle */}
                  <div className={'shrink-0 w-16 h-16 rounded-2xl flex flex-col items-center justify-center ' + meta.bg}>
                    <div className={'text-xl font-bold ' + meta.text}>{a.riskScore}</div>
                    <div className="text-[9px] text-stone-400 dark:text-stone-500">/100</div>
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{hiveName(a.hiveId)}</div>
                    <div className={'inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ' + meta.bg + ' ' + meta.text}>
                      <Wind size={11} /> {meta.label} risk
                    </div>
                    {a.daysUntilLikelySwarm != null && (
                      <div className="text-xs text-red-600 dark:text-red-400 font-medium mt-1 flex items-center gap-1">
                        <Clock size={11} /> ~{a.daysUntilLikelySwarm}d until swarm
                      </div>
                    )}
                  </div>
                  {/* Mini bar */}
                  <div className="shrink-0 w-2 h-16 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden flex flex-col-reverse">
                    <div className={'w-full ' + meta.bar} style={{ height: a.riskScore + '%' }} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && assessments.length > 0 && (
        <p className="text-xs text-stone-400 dark:text-stone-500 text-center px-4">
          Swarm risk is calculated from recent inspections, season, and colony conditions. Tap a hive for details.
        </p>
      )}
    </div>
  );
}