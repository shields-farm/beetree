import { useEffect, useMemo, useState } from 'react';
import { Network, Bug, Boxes, Search, ChevronRight, RefreshCw, Globe, Activity } from 'lucide-react';
import { apiFetch } from '../lib/apiBase';
import { Card } from '../components/Card';

interface Summary {
  vocab: { name: string; version: string; schema_version: string };
  entityCount: number;
  entitiesByType: Record<string, number>;
  threatCount: number;
  threatKinds: Record<string, number>;
  predicates: string[];
  edgeCount: number;
  activeStates: number;
  eventCount: number;
  currentSeason: string | null;
}

interface OntoEntity {
  entity_id: string;
  entity_type: string;
  name: string | null;
  properties: Record<string, unknown> | string;
  source_table?: string | null;
  source_id?: string | null;
}

interface Threat {
  species_id: string;
  name: string;
  scientific?: string;
  kind: string;
  notifiable?: number;
  notes?: string;
}

interface RelationRow {
  entity_id: string;
  subject_id: string;
  predicate: string;
  object_id: string;
  confidence: number;
  evidence: string[];
}

interface Graph {
  node: OntoEntity | null;
  edges: RelationRow[];
  neighbors: OntoEntity[];
}

type Tab = 'graph' | 'threats';

export function World() {
  const [tab, setTab] = useState<Tab>('graph');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entities, setEntities] = useState<OntoEntity[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Graph | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [states, setStates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e, t] = await Promise.all([
        apiFetch('/api/ontology/summary').then((r) => r.json()),
        apiFetch('/api/ontology/entities').then((r) => r.json()),
        apiFetch('/api/ontology/threats').then((r) => r.json()),
      ]);
      setSummary(s);
      setEntities(Array.isArray(e) ? e : []);
      setThreats(Array.isArray(t) ? t : []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load world model');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        (e.name ?? '').toLowerCase().includes(q) ||
        e.entity_id.toLowerCase().includes(q) ||
        e.entity_type.toLowerCase().includes(q)
    );
  }, [entities, query]);

  const filteredThreats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threats;
    return threats.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.species_id.toLowerCase().includes(q) ||
        (t.scientific ?? '').toLowerCase().includes(q) ||
        t.kind.toLowerCase().includes(q)
    );
  }, [threats, query]);

  const openEntity = async (id: string) => {
    setSelectedId(id);
    try {
      const [g, st] = await Promise.all([
        apiFetch(`/api/ontology/entity/${encodeURIComponent(id)}/graph`).then((r) => r.json()),
        apiFetch(`/api/ontology/entity/${encodeURIComponent(id)}/state`).then((r) => r.json()),
      ]);
      setSelected(g);
      setStates(Array.isArray(st) ? st : []);
    } catch {
      setSelected(null);
      setStates([]);
    }
  };

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-400">
        <div className="w-6 h-6 border-2 border-honey-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-800 dark:text-stone-100 flex items-center gap-2">
            <Globe size={22} className="text-honey-500" /> World Model
          </h1>
          {summary && (
            <p className="text-xs text-stone-400 mt-0.5">
              {summary.vocab.name}@{summary.vocab.version} · season: {summary.currentSeason ?? 'unknown'}
            </p>
          )}
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <Card className="border-red-200 dark:border-red-900">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.entityCount}</div>
            <div className="text-xs text-stone-400">entities</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.edgeCount}</div>
            <div className="text-xs text-stone-400">relations</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.threatCount}</div>
            <div className="text-xs text-stone-400">threat species</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.activeStates}</div>
            <div className="text-xs text-stone-400">active states</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.eventCount}</div>
            <div className="text-xs text-stone-400">events</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{summary.predicates.length}</div>
            <div className="text-xs text-stone-400">predicates</div>
          </Card>
        </div>
      )}

      {/* Inner tabs */}
      <div className="flex gap-2 border-b border-stone-200 dark:border-stone-800">
        <button
          onClick={() => setTab('graph')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === 'graph'
              ? 'border-honey-500 text-honey-600 dark:text-honey-300'
              : 'border-transparent text-stone-400 hover:text-stone-600'
          }`}
        >
          <Network size={15} /> Entities
        </button>
        <button
          onClick={() => setTab('threats')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === 'threats'
              ? 'border-honey-500 text-honey-600 dark:text-honey-300'
              : 'border-transparent text-stone-400 hover:text-stone-600'
          }`}
        >
          <Bug size={15} /> Threat Catalog
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'graph' ? 'Search entities…' : 'Search threats…'}
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-sm text-stone-800 dark:text-stone-100 placeholder-stone-400"
        />
      </div>

      {tab === 'graph' && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Entity list */}
          <div className="space-y-2">
            {filtered.length === 0 && (
              <p className="text-sm text-stone-400 py-8 text-center">
                No entities yet. Entities are created as Buzz asserts facts about colonies, hives, and events.
              </p>
            )}
            {filtered.map((e) => (
              <button
                key={e.entity_id}
                onClick={() => openEntity(e.entity_id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors flex items-center gap-3 ${
                  selectedId === e.entity_id
                    ? 'border-honey-400 bg-honey-50 dark:bg-honey-950'
                    : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-honey-300'
                }`}
              >
                <Boxes size={16} className="text-stone-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate">
                    {e.name ?? e.entity_id}
                  </div>
                  <div className="text-xs text-stone-400">{e.entity_type}</div>
                </div>
                <ChevronRight size={14} className="text-stone-300 shrink-0" />
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div>
            {!selected && (
              <Card>
                <p className="text-sm text-stone-400 text-center py-6">
                  Select an entity to view its graph, relations, and current inferred states.
                </p>
              </Card>
            )}
            {selected?.node && (
              <div className="space-y-3">
                <Card>
                  <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                    {selected.node.name ?? selected.node.entity_id}
                  </div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {selected.node.entity_type} · {selected.node.entity_id}
                  </div>
                  {states.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                        <Activity size={12} /> Current inferred states
                      </div>
                      {states.map((s: any) => (
                        <div
                          key={s.id ?? s.entity_id}
                          className="text-xs px-2 py-1 rounded-lg bg-honey-50 dark:bg-honey-950 text-honey-700 dark:text-honey-300"
                        >
                          <span className="font-medium">{s.state_class}</span>
                          {s.rationale && <span className="text-honey-600/70"> — {s.rationale}</span>}
                          <span className="text-honey-500/50"> (conf {Math.round((s.confidence ?? 0) * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {selected.edges.length > 0 && (
                  <Card>
                    <div className="text-xs font-medium text-stone-500 mb-2">Relations</div>
                    <div className="space-y-1.5">
                      {selected.edges.map((r) => (
                        <div key={r.entity_id} className="text-xs text-stone-600 dark:text-stone-300 flex flex-wrap items-center gap-1">
                          <span className="font-medium">{shortId(r.subject_id)}</span>
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-honey-600 dark:text-honey-300 font-mono text-[10px]">
                            {r.predicate}
                          </span>
                          <span className="font-medium">{shortId(r.object_id)}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {selected.edges.length === 0 && (
                  <Card>
                    <p className="text-xs text-stone-400 text-center py-3">No relations asserted yet.</p>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'threats' && (
        <div className="grid sm:grid-cols-2 gap-2">
          {filteredThreats.map((t) => (
            <Card key={t.species_id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-800 dark:text-stone-100">{t.name}</div>
                  {t.scientific && (
                    <div className="text-xs italic text-stone-400">{t.scientific}</div>
                  )}
                  {t.notes && (
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2">{t.notes}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${kindBadge(t.kind)}`}>
                    {t.kind}
                  </span>
                  {t.notifiable ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-300 font-medium">
                      notifiable
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string {
  // Humanize entity ids in relation rows: prefer the linked entity's name if we've seen it.
  return id.replace(/^onto_/, '').split('_').slice(0, 3).join('_');
}

function kindBadge(kind: string): string {
  switch (kind) {
    case 'pest':
      return 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300';
    case 'parasite':
      return 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300';
    case 'disease':
      return 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300';
    default:
      return 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300';
  }
}
