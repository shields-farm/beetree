import { useEffect, useState } from 'react';
import {
  GitCompare,
  Loader2,
  AlertTriangle,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  CheckCircle2,
} from 'lucide-react';
import { Card } from '../components/Card';

import { API_BASE, apiFetch } from '../lib/apiBase';

interface HiveStat {
  hiveId: string;
  hiveName: string;
  healthStatus: string;
  populationSize: string;
  honeyStores: string;
  lastInspectionDays: number;
  concerns: number;
  score: number;
}

interface OutlierEntry {
  hiveId: string;
  hiveName: string;
  reason: string;
  severity: 'minor' | 'moderate' | 'significant';
  detail: string;
}

interface OutlierReport {
  apiaryId: string;
  apiaryName: string;
  hiveStats: HiveStat[];
  outliers: OutlierEntry[];
  apiaryAverage: { health: number; population: number; concerns: number };
}

const SEVERITY_META: Record<OutlierEntry['severity'], { label: string; bg: string; text: string }> = {
  significant: { label: 'Significant', bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800' },
  moderate: { label: 'Moderate', bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800' },
  minor: { label: 'Minor', bg: 'bg-yellow-50', text: 'text-yellow-700' },
};

function scoreColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  if (score >= 25) return 'bg-orange-500';
  return 'bg-red-500';
}

function isOutlier(report: OutlierReport, hiveId: string): OutlierEntry | undefined {
  return report.outliers.find((o) => o.hiveId === hiveId);
}

export function OutlierDetection() {
  const [reports, setReports] = useState<OutlierReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApiaryId, setSelectedApiaryId] = useState<string>('all');
  const [expandedHives, setExpandedHives] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(API_BASE + '/api/outlier')
      .then((r) => r.json())
      .then((data: OutlierReport[]) => {
        setReports(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load outlier reports');
        setLoading(false);
      });
  }, []);

  function toggleHive(key: string) {
    setExpandedHives((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="animate-fade-in space-y-5">
        <Card>
          <div className="flex items-center justify-center py-8 text-stone-400 dark:text-stone-500 text-sm">
            <Loader2 size={20} className="animate-spin mr-2" /> Analyzing apiaries…
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fade-in space-y-5">
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

  const visibleReports = selectedApiaryId === 'all'
    ? reports
    : reports.filter((r) => r.apiaryId === selectedApiaryId);

  return (
    <div className="animate-fade-in space-y-5">
      {/* Apiary selector */}
      <Card>
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">Apiary</label>
        <select
          className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3 py-2 text-sm"
          value={selectedApiaryId}
          onChange={(e) => setSelectedApiaryId(e.target.value)}
        >
          <option value="all">All Apiaries</option>
          {reports.map((r) => (
            <option key={r.apiaryId} value={r.apiaryId}>{r.apiaryName}</option>
          ))}
        </select>
      </Card>

      {visibleReports.length === 0 && (
        <Card>
          <p className="text-sm text-stone-400 dark:text-stone-500 text-center py-4">No apiaries found.</p>
        </Card>
      )}

      {visibleReports.map((report) => (
        <div key={report.apiaryId} className="space-y-3">
          {/* Apiary header */}
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-honey-500" />
            <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">{report.apiaryName}</h2>
            {report.outliers.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
                {report.outliers.length} outlier{report.outliers.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {/* Bar chart of hive scores */}
          <Card>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Hive Scores</h3>
            <div className="space-y-2.5">
              {report.hiveStats.map((h) => {
                const outlier = isOutlier(report, h.hiveId);
                return (
                  <div key={h.hiveId}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={'font-medium ' + (outlier ? 'text-red-700 dark:text-red-300' : 'text-stone-700 dark:text-stone-200')}>
                        {h.hiveName}
                        {outlier && <AlertTriangle size={12} className="ml-1 inline text-amber-500" />}
                      </span>
                      <span className="text-stone-500 dark:text-stone-400">{h.score}/100</span>
                    </div>
                    <div className="h-5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <div
                        className={'h-full rounded-full transition-all ' + scoreColor(h.score)}
                        style={{ width: Math.max(2, h.score) + '%' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Average line */}
            <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
              <span>Avg health: {Math.round(report.apiaryAverage.health)}</span>
              <span>Avg population: {Math.round(report.apiaryAverage.population)}</span>
              <span>Avg concerns: {report.apiaryAverage.concerns.toFixed(1)}</span>
            </div>
          </Card>

          {/* Outlier detail cards */}
          {report.outliers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
                <TrendingDown size={16} className="text-red-500 dark:text-red-400" /> Outliers
              </h3>
              <div className="space-y-2">
                {report.outliers.map((o, i) => {
                  const meta = SEVERITY_META[o.severity];
                  const key = report.apiaryId + '-' + o.hiveId;
                  const expanded = expandedHives.has(key);
                  const stat = report.hiveStats.find((h) => h.hiveId === o.hiveId);
                  return (
                    <Card key={i} className={o.severity === 'significant' ? 'border-red-200' : o.severity === 'moderate' ? 'border-amber-200' : ''}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-stone-800 dark:text-stone-100">{o.hiveName}</span>
                            <span className={'px-2 py-0.5 rounded-full text-[11px] font-medium ' + meta.bg + ' ' + meta.text}>
                              {meta.label}
                            </span>
                          </div>
                          <p className="text-sm text-stone-600 dark:text-stone-300 mt-1">{o.reason}</p>
                          {expanded && (
                            <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-500 dark:text-stone-400 space-y-1">
                              <p>{o.detail}</p>
                              {stat && (
                                <div className="flex flex-wrap gap-3 mt-1">
                                  <span>Score: {stat.score}</span>
                                  <span>Health: {stat.healthStatus}</span>
                                  <span>Pop: {stat.populationSize}</span>
                                  <span>Honey: {stat.honeyStores}</span>
                                  <span>Concerns: {stat.concerns}</span>
                                  <span>Last inspect: {stat.lastInspectionDays >= 0 ? stat.lastInspectionDays + 'd' : 'never'}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <button onClick={() => toggleHive(key)} className="shrink-0 p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700">
                          {expanded ? <ChevronDown size={16} className="text-stone-400 dark:text-stone-500" /> : <ChevronRight size={16} className="text-stone-400 dark:text-stone-500" />}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inspect next recommendation */}
          {report.outliers.length > 0 && (
            <div className="rounded-2xl bg-honey-50 dark:bg-honey-950 border border-honey-200 p-4 flex items-start gap-3 dark:border-honey-800">
              <Lightbulb size={20} className="text-honey-600 dark:text-honey-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm text-honey-800 dark:text-honey-200">Inspect this hive next</p>
                <p className="text-xs text-honey-700 dark:text-honey-300 mt-0.5">
                  Prioritize <strong>{report.outliers[0].hiveName}</strong> — {report.outliers[0].reason}
                </p>
              </div>
            </div>
          )}

          {report.outliers.length === 0 && (
            <Card>
              <p className="text-sm text-green-700 dark:text-green-300 text-center py-2 flex items-center justify-center gap-1.5"><CheckCircle2 size={15} /> All hives are within normal range.</p>
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}