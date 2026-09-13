import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock, ChevronRight, Thermometer, Flower2, Crown, Bug,
  CheckCircle2, Activity, Boxes,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChat, AskAIButton } from '../components/ChatContext';
import { generateAlerts } from '../lib/alerts';
import { HEALTH_META } from '../lib/health';
import { API_BASE, apiFetch } from '../lib/apiBase';
import { TelemetryTab } from '../components/TelemetryTab';
import { getPestPrefs, filterTreatments } from '../lib/pestPrefs';
import { useAnomalies } from '../lib/useAnomalies';
import { AlertQueue } from '../components/AlertQueue';
import { PageTabs } from '../components/PageTabs';
import { DataFreshness } from '../components/DataFreshness';

// ─── Types (mirror server modules) ───────────────────────────────────────────
interface ForageFlow {
  plant: string;
  status: 'upcoming' | 'active' | 'ending' | 'dormant';
  startMonth: string;
  endMonth: string;
  notes: string;
  significant?: boolean;
  commonness?: number;
  latinName?: string;
  plantType?: string;
}
interface ForageForecast {
  month: string;
  majorFlows: ForageFlow[];
  recommendation: string;
  managementTips: string[];
}

interface QueenStatus {
  hiveId: string;
  hiveName: string;
  currentQueen: { date: string; queenColor: string; queenYear: number; source: string } | null;
  history: any[];
  supersedureSuspected: boolean;
  daysSinceLastSeen: number | null;
  notes: string;
}

interface SwarmRiskAssessment {
  hiveId: string;
  riskScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'very-high';
  factors: { factor: string; weight: number; detail: string }[];
  recommendations: string[];
  daysUntilLikelySwarm: number | null;
}

interface TreatmentRec {
  hiveId: string;
  hiveName: string;
  treatments: { type: string; timing: string; reason: string; priority: 'high' | 'medium' | 'low'; notes: string }[];
  season: string;
  warnings: string[];
}

// ─── Feeding logic ───────────────────────────────────────────────────────────
/** Determine syrup ratio recommendation by month for Georgia. */
function syrupRatioFor(month: number): { ratio: string; reason: string } | null {
  if (month === 0 || month === 11) return { ratio: '2:1', reason: 'Winter — feed fondant or 2:1 syrup if stores light' };
  if (month === 1) return { ratio: '1:1', reason: 'Late winter — 1:1 syrup stimulates brood rearing' };
  if (month === 2 || month === 3) return { ratio: '1:1', reason: 'Spring build-up — 1:1 syrup encourages expansion' };
  if (month === 4 || month === 5) return { ratio: '1:1', reason: 'Flow starting — feed only if weather blocks forage' };
  if (month >= 6 && month <= 7) return { ratio: '2:1', reason: 'Summer dearth — 2:1 syrup if stores are low' };
  if (month >= 8 && month <= 9) return { ratio: '2:1', reason: 'Fall build-up — 2:1 syrup for winter stores' };
  if (month === 10) return { ratio: '2:1', reason: 'Late fall — last chance to feed 2:1 before cold' };
  return null;
}

/** Check if any hive has low honey/pollen stores based on latest inspection. */
function checkLowStores(hives: any[], inspections: any[]): { hiveName: string; honey: string; pollen: string }[] {
  const low: { hiveName: string; honey: string; pollen: string }[] = [];
  for (const hive of hives) {
    const hiveInspections = inspections
      .filter((i) => i.hiveId === hive.id)
      .sort((a: any, b: any) => b.date.localeCompare(a.date));
    const last = hiveInspections[0];
    if (!last) continue;
    const daysSince = Math.floor((Date.now() - new Date(last.date).getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince > 30) continue;
    if (last.honeyStores === 'none' || last.honeyStores === 'low' || last.pollenStores === 'none' || last.pollenStores === 'low') {
      low.push({ hiveName: hive.name, honey: last.honeyStores, pollen: last.pollenStores });
    }
  }
  return low;
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
type TabId = 'now' | 'alerts' | 'telemetry' | 'hives';

// ============================================================================
// DASHBOARD
// ============================================================================
export function Dashboard() {
  const { hives, inspections, sensors, tasks } = useStore();
  const { setQuickQuestions } = useChat();
  const alerts = generateAlerts(hives, inspections, sensors, tasks);
  const anomalies = useAnomalies();
  const [tab, setTab] = useState<TabId>('now');

  const [forage, setForage] = useState<ForageForecast | null>(null);
  const [queenStatuses, setQueenStatuses] = useState<QueenStatus[]>([]);
  const [swarmRisks, setSwarmRisks] = useState<SwarmRiskAssessment[]>([]);
  const [treatments, setTreatments] = useState<TreatmentRec[]>([]);

  // Fetch all dashboard data in parallel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [forageRes, queenRes, swarmRes, treatmentRes] = await Promise.all([
        apiFetch(API_BASE + '/api/forage').then((r) => r.ok ? r.json() : null).catch(() => null),
        apiFetch(API_BASE + '/api/queen/all').then((r) => r.ok ? r.json() : null).catch(() => null),
        apiFetch(API_BASE + '/api/swarm/risk').then((r) => r.ok ? r.json() : null).catch(() => null),
        apiFetch(API_BASE + '/api/treatment').then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (cancelled) return;
      if (forageRes?.current) setForage(forageRes.current);
      if (queenRes) setQueenStatuses(queenRes);
      if (swarmRes) setSwarmRisks(swarmRes);
      if (treatmentRes) setTreatments(treatmentRes);
    })();
    return () => { cancelled = true; };
  }, []);

  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;

  useEffect(() => {
    const qs = [
      'What should I prioritize today?',
      'Which hive needs attention most?',
      "What's my seasonal focus right now?",
    ];
    if (urgentCount > 0) qs.unshift('I have urgent alerts — walk me through them');
    setQuickQuestions(qs);
    return () => setQuickQuestions([]);
  }, [setQuickQuestions, urgentCount]);

  // Health distribution
  const healthBuckets = useMemo(() => {
    const buckets: Record<string, number> = { excellent: 0, good: 0, fair: 0, poor: 0, critical: 0 };
    hives.forEach((h) => { buckets[h.healthStatus] = (buckets[h.healthStatus] ?? 0) + 1; });
    return buckets;
  }, [hives]);

  // Pillar data
  const currentMonth = new Date().getMonth();
  const lowStores = checkLowStores(hives, inspections);
  const syrupRec = syrupRatioFor(currentMonth);
  const significantActiveFlows = forage?.majorFlows.filter(
    (f) => (f.status === 'active' || f.status === 'ending') && f.significant,
  ) ?? [];
  const allActiveFlows = forage?.majorFlows.filter(
    (f) => f.status === 'active' || f.status === 'ending',
  ) ?? [];

  // Queen pillar summary
  const queenIssues = queenStatuses.filter((q) => {
    if (!q.currentQueen) return false;
    if (q.supersedureSuspected) return true;
    if (q.daysSinceLastSeen !== null && q.daysSinceLastSeen > 30) return true;
    return false;
  });
  const hivesWithoutQueenRecords = queenStatuses.length > 0
    ? queenStatuses.filter((q) => !q.currentQueen).length
    : 0;

  // Pests pillar — filter treatments by pest prefs
  const pestPrefs = getPestPrefs();
  const filteredTreatments = useMemo(() =>
    treatments.map((t) => ({
      ...t,
      treatments: filterTreatments(t.treatments, pestPrefs),
    })).filter((t) => t.treatments.length > 0 || t.warnings.length > 0),
    [treatments, pestPrefs],
  );
  const highPriorityTreatments = filteredTreatments.filter((t) =>
    t.treatments.some((tr) => tr.priority === 'high') || t.warnings.length > 0,
  );

  // Swarm risk
  const elevatedSwarmRisks = swarmRisks.filter((s) => s.riskLevel === 'moderate' || s.riskLevel === 'high' || s.riskLevel === 'very-high');

  // Tab badge counts — both real, no hardcoded zero
  const telemetryBadge = anomalies.total > 0 ? anomalies.total : 0;
  const alertsBadge = alerts.filter((a) => a.severity === 'urgent' || a.severity === 'warning').length;

  const TABS = [
    { id: 'now' as const, label: 'Now', icon: <Clock size={15} /> },
    { id: 'alerts' as const, label: 'Alerts', icon: <Activity size={15} />, badge: alertsBadge },
    { id: 'telemetry' as const, label: 'Telemetry', icon: <Thermometer size={15} />, badge: telemetryBadge },
    { id: 'hives' as const, label: 'Hives', icon: <Boxes size={15} /> },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header with global freshness — the app previously had no app-wide
          "when did we last hear from the hives" signal anywhere. */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-xl sm:text-2xl font-bold text-stone-800 dark:text-stone-100">Dashboard</h1>
        <DataFreshness />
      </div>

      <PageTabs tabs={TABS} value={tab} onChange={setTab} />

      {/* ── NOW tab — prioritized queue ────────────────────────────────── */}
      {tab === 'now' && (
        <div className="space-y-5">
          <AlertQueue />
          <div className="pt-1">
            <AskAIButton prompt="What should I focus on right now? Give me the short version." label="Ask Buzz" />
          </div>
        </div>
      )}

      {/* ── ALERTS tab — pillar cards ──────────────────────────────────── */}
      {tab === 'alerts' && (
        <div className="space-y-5">
          <div className="space-y-3">
            <PillarCard
              icon={Crown}
              title="Queen"
              status={queenIssues.length === 0 && hivesWithoutQueenRecords === 0 ? 'good' : queenIssues.length > 0 ? 'warning' : 'info'}
              linkTo="/hives?tab=queen"
            >
              {queenStatuses.length === 0 ? (
                <PillarLine text="No queen records yet" muted />
              ) : queenIssues.length > 0 ? (
                queenIssues.slice(0, 2).map((q) => (
                  <PillarLine
                    key={q.hiveId}
                    text={q.hiveName}
                    detail={
                      q.supersedureSuspected ? 'Supersedure suspected' :
                      q.daysSinceLastSeen !== null ? `Not seen ${q.daysSinceLastSeen}d` : ''
                    }
                    warning
                  />
                ))
              ) : hivesWithoutQueenRecords > 0 ? (
                <PillarLine text={`${hivesWithoutQueenRecords} hive${hivesWithoutQueenRecords !== 1 ? 's' : ''} without queen records`} muted />
              ) : (
                <PillarLine text="All queens tracked" check />
              )}
            </PillarCard>

            <PillarCard
              icon={Flower2}
              title="Nutrition"
              status={lowStores.length > 0 ? 'warning' : 'good'}
              linkTo="/forage"
            >
              {/* Significant active flows */}
              {significantActiveFlows.length > 0 ? (
                <PillarLine
                  text={significantActiveFlows.map((f) => f.plant).join(', ')}
                  detail="flowing now"
                />
              ) : allActiveFlows.length === 0 ? (
                <PillarLine text="No active nectar flow" muted />
              ) : (
                <PillarLine text="Minor flows only" muted />
              )}
              {/* Low stores alert */}
              {lowStores.length > 0 && (
                <PillarLine
                  text={`${lowStores.length} hive${lowStores.length !== 1 ? 's' : ''} low stores`}
                  detail={lowStores.slice(0, 2).map((s) => s.hiveName).join(', ')}
                  warning
                />
              )}
              {/* Feeding recommendation */}
              {syrupRec && (lowStores.length > 0 || currentMonth >= 8 || currentMonth <= 1) && (
                <PillarLine
                  text={`Feed ${syrupRec.ratio} syrup`}
                  detail={syrupRec.reason}
                />
              )}
            </PillarCard>

            <PillarCard
              icon={Bug}
              title="Pests & Disease"
              status={highPriorityTreatments.length > 0 ? 'warning' : 'good'}
              linkTo="/hives?tab=treatments"
            >
              {highPriorityTreatments.length > 0 ? (
                highPriorityTreatments.slice(0, 2).map((t) => (
                  <PillarLine
                    key={t.hiveId}
                    text={t.hiveName}
                    detail={t.warnings.length > 0 ? t.warnings[0] : t.treatments.find((tr) => tr.priority === 'high')?.type ?? 'Treatment needed'}
                    warning
                  />
                ))
              ) : filteredTreatments.length > 0 ? (
                <PillarLine text={`${filteredTreatments.length} hive${filteredTreatments.length !== 1 ? 's' : ''} with treatments queued`} muted />
              ) : (
                <PillarLine text="No active pest concerns" check />
              )}
            </PillarCard>

            <PillarCard
              icon={Activity}
              title="Swarm Risk"
              status={elevatedSwarmRisks.length > 0 ? 'warning' : 'good'}
              linkTo="/hives?tab=swarm"
            >
              {elevatedSwarmRisks.length > 0 ? (
                elevatedSwarmRisks.slice(0, 2).map((s) => (
                  <PillarLine
                    key={s.hiveId}
                    text={hives.find((h) => h.id === s.hiveId)?.name ?? s.hiveId}
                    detail={`${s.riskLevel.replace('-', ' ')} risk (${s.riskScore}/100)`}
                    warning
                  />
                ))
              ) : swarmRisks.length > 0 ? (
                <PillarLine text="No hives at elevated swarm risk" check />
              ) : (
                <PillarLine text="No swarm assessment yet" muted />
              )}
            </PillarCard>
          </div>
        </div>
      )}

      {/* ── TELEMETRY tab ───────────────────────────────────────────────── */}
      {tab === 'telemetry' && (
        <TelemetryTab />
      )}

      {/* ── HIVES tab ───────────────────────────────────────────────────── */}
      {tab === 'hives' && (
        <div className="space-y-4">
          {hives.length > 0 ? (
            <>
              {/* Health distribution bar */}
              <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Hive Health</h3>
                  <Link to="/hives" className="text-xs text-stone-400 dark:text-stone-500 hover:text-honey-600">All hives →</Link>
                </div>
                <div className="flex gap-1.5">
                  {(['excellent', 'good', 'fair', 'poor', 'critical'] as const).map((status) => {
                    const count = healthBuckets[status] ?? 0;
                    if (count === 0) return null;
                    const meta = HEALTH_META[status];
                    const pct = (count / hives.length) * 100;
                    return (
                      <div
                        key={status}
                        className={`${meta.bg} rounded-lg px-2 py-1.5 text-center`}
                        style={{ flex: pct }}
                        title={`${meta.label}: ${count}`}
                      >
                        <div className={`text-sm font-bold ${meta.text}`}>{count}</div>
                        <div className={`text-[9px] ${meta.text} capitalize`}>{meta.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Hive list with health dots */}
              <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-4">
                <div className="space-y-1.5">
                  {hives.map((h) => {
                    const meta = HEALTH_META[h.healthStatus];
                    return (
                      <Link key={h.id} to={`/hives/${h.id}`} className="flex items-center gap-2 text-xs hover:bg-stone-50 dark:hover:bg-stone-800 rounded-lg px-1 py-1.5 transition-colors">
                        <span className={`w-2 h-2 rounded-full ${meta.dot} shrink-0`} />
                        <span className="text-stone-600 dark:text-stone-300 truncate flex-1">{h.name}</span>
                        <span className={`text-[10px] ${meta.text} capitalize`}>{meta.label}</span>
                        <ChevronRight size={14} className="text-stone-300 dark:text-stone-600" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-card border border-stone-100 dark:border-stone-800 p-6 text-center">
              <Boxes size={24} className="text-stone-300 dark:text-stone-600 mx-auto mb-2" />
              <p className="text-sm text-stone-400 dark:text-stone-500">No hives yet.</p>
              <Link to="/hives" className="text-xs text-honey-600 dark:text-honey-400 font-medium mt-2 inline-block">Add a hive →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pillar Card ─────────────────────────────────────────────────────────────
function PillarCard({
  icon: Icon,
  title,
  status,
  linkTo,
  children,
}: {
  icon: typeof Crown;
  title: string;
  status: 'good' | 'warning' | 'info';
  linkTo: string;
  children: React.ReactNode;
}) {
  const statusMeta = {
    good: { border: 'border-green-200 dark:border-green-900', accent: 'text-green-500' },
    warning: { border: 'border-amber-200 dark:border-amber-900', accent: 'text-amber-500' },
    info: { border: 'border-sky-200 dark:border-sky-900', accent: 'text-sky-500' },
  };
  const s = statusMeta[status];

  return (
    <Link
      to={linkTo}
      className={`block bg-white dark:bg-stone-900 rounded-2xl shadow-card border ${s.border} p-3.5 hover:shadow-md transition-shadow group`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} className={s.accent} />
        <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</span>
        <ChevronRight size={14} className="text-stone-300 dark:text-stone-600 ml-auto group-hover:text-honey-500 transition-colors" />
      </div>
      <div className="space-y-1">
        {children}
      </div>
    </Link>
  );
}

function PillarLine({
  text,
  detail,
  warning,
  muted,
  check,
}: {
  text: string;
  detail?: string;
  warning?: boolean;
  muted?: boolean;
  check?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      {check ? (
        <CheckCircle2 size={12} className="text-green-500 mt-0.5 shrink-0" />
      ) : warning ? (
        <Activity size={12} className="text-amber-500 mt-0.5 shrink-0" />
      ) : muted ? (
        <span className="w-3 h-3 shrink-0" />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${warning ? 'bg-amber-500' : 'bg-honey-400'}`} />
      )}
      <div className="min-w-0 flex-1">
        <span className={muted ? 'text-stone-400 dark:text-stone-500' : warning ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-stone-700 dark:text-stone-200 font-medium'}>
          {text}
        </span>
        {detail && (
          <span className="text-stone-400 dark:text-stone-500 ml-1">— {detail}</span>
        )}
      </div>
    </div>
  );
}
