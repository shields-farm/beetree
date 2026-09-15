import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Bug, Boxes, Search, ChevronRight, RefreshCw, Globe, Activity, MessageCircle, Quote, Link2, PlayCircle, AlertTriangle } from 'lucide-react';
import { apiFetch, statusToMessage } from '../lib/apiBase';
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

interface ThreatClaim {
  subject_type: string;
  subject_id: string;
  claim: string;
  quote: string;
  kind: string | null;
  context: string | null;
  confidence: number;
  episode: number;
  video_id: string;
  start_s: number | null;
  end_s: number | null;
  youtube_url: string | null;
}

/** Seconds -> m:ss for a video timestamp. */
function fmtTime(s: number | null | undefined): string {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface ThreatDetail {
  species: Threat;
  entity: OntoEntity | null;
  claims: ThreatClaim[];
  claimCount: number;
  episodes: number[];
  edges: RelationRow[];
  relatedSpecies: (Threat & { predicate: string; confidence: number })[];
  hasKnowledge: boolean;
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
  const navigate = useNavigate();
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
  // Set when a detail fetch fails. Without this the panel rendered nothing at
  // all: a 429/500 body was parsed as if it were the graph, so `selected` was
  // truthy but had no `.node` — killing the placeholder AND the detail view and
  // leaving an empty column. Browsing a few entities quickly was enough to hit
  // the per-IP rate limit and blank the panel.
  const [detailError, setDetailError] = useState<string | null>(null);
  // Threat catalog — cards expand inline. Multiple can be open at once, and fetched
  // details are cached per species so re-opening is instant and costs no request.
  const [detailCache, setDetailCache] = useState<Record<string, ThreatDetail>>({});
  const [openThreats, setOpenThreats] = useState<Set<string>>(new Set());
  const [loadingThreats, setLoadingThreats] = useState<Set<string>>(new Set());
  const [expandedQuotes, setExpandedQuotes] = useState<Set<string>>(new Set());

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

  /**
   * Open an entity's graph + current inferred states.
   *
   * Guardrails that matter here:
   *  - `!r.ok` is checked before parsing. The API returns JSON error bodies
   *    ({"error":"Rate limit exceeded..."}) with a 4xx status, and parsing one as
   *    a graph produced a truthy object with no `.node`, which blanked the panel.
   *  - the shape is validated before it is stored, so a malformed body can never
   *    render as an empty detail column.
   */
  const openEntity = async (id: string) => {
    setSelectedId(id);
    setDetailError(null);
    try {
      const [gr, sr] = await Promise.all([
        apiFetch(`/api/ontology/entity/${encodeURIComponent(id)}/graph`),
        apiFetch(`/api/ontology/entity/${encodeURIComponent(id)}/state`),
      ]);
      if (!gr.ok) {
        const body = await gr.json().catch(() => ({}));
        throw new Error(
          gr.status === 429
            ? 'Slow down — too many requests. Try again in a moment.'
            : (body?.error || statusToMessage(gr.status)),
        );
      }
      const g = await gr.json();
      const st = sr.ok ? await sr.json() : [];
      if (!g || typeof g !== 'object' || !('node' in g)) {
        throw new Error('Unexpected response from the ontology graph.');
      }
      setSelected(g as Graph);
      setStates(Array.isArray(st) ? st : []);
    } catch (err: any) {
      setSelected(null);
      setStates([]);
      setDetailError(err?.message ?? 'Could not load this entity.');
    }
  };

  // Toggle a threat card's inline detail. Multiple can be open at once; details are
  // cached per species so re-opening is instant and makes no extra request.
  //
  // On failure the card previously fell through to its "no cited knowledge yet"
  // copy, which was a lie: the species may carry 87 claims and we simply got a
  // 429. Failures are tracked per species so the card can say what actually
  // happened instead of claiming the corpus is empty.
  const [threatError, setThreatError] = useState<Record<string, string>>({});

  const openThreat = async (speciesId: string) => {
    setOpenThreats((prev) => {
      const next = new Set(prev);
      if (next.has(speciesId)) next.delete(speciesId);
      else next.add(speciesId);
      return next;
    });
    if (detailCache[speciesId]) return;         // already fetched
    setLoadingThreats((prev) => new Set(prev).add(speciesId));
    setThreatError((prev) => {
      const next = { ...prev };
      delete next[speciesId];
      return next;
    });
    try {
      const r = await apiFetch(`/api/ontology/threats/${encodeURIComponent(speciesId)}/detail`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          r.status === 429
            ? 'Too many requests — try again in a moment.'
            : (body?.error || statusToMessage(r.status)),
        );
      }
      const d = await r.json();
      if (!d || typeof d !== 'object') throw new Error('Unexpected response from the ontology.');
      setDetailCache((prev) => ({ ...prev, [speciesId]: d }));
    } catch (err: any) {
      setThreatError((prev) => ({ ...prev, [speciesId]: err?.message ?? 'Could not load this species.' }));
    } finally {
      setLoadingThreats((prev) => {
        const next = new Set(prev);
        next.delete(speciesId);
        return next;
      });
    }
  };

  const closeThreat = (speciesId?: string) => {
    if (speciesId) {
      setOpenThreats((prev) => {
        const next = new Set(prev);
        next.delete(speciesId);
        return next;
      });
    } else {
      setOpenThreats(new Set());
    }
  };

  // Quote toggles are keyed by `speciesId:index` so cards don't interfere.
  const toggleQuote = (key: string) => {
    setExpandedQuotes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hand a question about this species to Buzz, pre-filled in the chat box.
  const askBuzz = (t: { name: string; species_id: string; kind: string; scientific?: string }) => {
    const prompt =
      `Tell me about ${t.name}${t.scientific ? ` (${t.scientific})` : ''} — ` +
      `what it is, how to detect it, and what I should do about it in my hives. ` +
      `Then check my hives for anything related.`;
    navigate('/chat', { state: { initialPrompt: prompt } });
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

          {/* Detail panel — must always render one of: empty state, error, or detail.
              A bare `{selected?.node && ...}` left the column blank whenever the
              fetch failed, because `selected` was truthy but had no `.node`. */}
          <div>
            {detailError && (
              <Card className="mb-3 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
                <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p>{detailError}</p>
                    {selectedId && (
                      <button
                        onClick={() => openEntity(selectedId)}
                        className="text-xs underline mt-1 text-red-600 dark:text-red-300"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )}
            {!selected && !detailError && (
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
                          {s.rationale && <span className="text-honey-600/70 dark:text-honey-400"> — {s.rationale}</span>}
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
        <div className="space-y-2">
          {(openThreats.size > 0 || query) && (
            <div className="flex items-center justify-between text-xs text-stone-400 px-1">
              <span>
                {filteredThreats.length} of {threats.length} species
                {openThreats.size > 0 ? ` · ${openThreats.size} expanded` : ''}
              </span>
              {openThreats.size > 0 && (
                <button
                  onClick={() => closeThreat()}
                  className="hover:text-honey-600 dark:hover:text-honey-300"
                >
                  Collapse all
                </button>
              )}
            </div>
          )}
          {filteredThreats.length === 0 && (
            <p className="text-sm text-stone-400 py-8 text-center">No threats match that search.</p>
          )}

          {filteredThreats.map((t) => {
            const isOpen = openThreats.has(t.species_id);
            const isLoading = loadingThreats.has(t.species_id);
            const detail = detailCache[t.species_id];
            return (
              <div
                key={t.species_id}
                className={`rounded-xl border transition-colors overflow-hidden ${
                  isOpen
                    ? 'border-honey-400 dark:border-honey-700 bg-white dark:bg-stone-900'
                    : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-honey-300'
                }`}
              >
                {/* Card header — always visible, click to expand inline */}
                <button
                  onClick={() => openThreat(t.species_id)}
                  aria-expanded={isOpen}
                  className={`w-full text-left p-3 transition-colors ${
                    isOpen ? 'bg-honey-50 dark:bg-honey-950' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-800 dark:text-stone-100">
                          {t.name}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${kindBadge(t.kind)}`}>
                          {t.kind}
                        </span>
                        {t.notifiable ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-300 font-medium">
                            notifiable
                          </span>
                        ) : null}
                        {detail && detail.claimCount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-honey-100 dark:bg-honey-950 text-honey-700 dark:text-honey-300 font-medium">
                            {detail.claimCount} cited
                          </span>
                        )}
                      </div>
                      {t.scientific && (
                        <div className="text-xs italic text-stone-400 mt-0.5">{t.scientific}</div>
                      )}
                      {!isOpen && t.notes && (
                        <div className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2">
                          {t.notes}
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={15}
                      className={`text-stone-300 transition-transform shrink-0 mt-0.5 ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </div>
                </button>

                {/* Inline expanded detail */}
                {isOpen && (
                  <div className="border-t border-stone-100 dark:border-stone-800 px-3 pb-3 pt-3 space-y-3">
                    {isLoading && !detail && (
                      <div className="flex items-center justify-center py-6">
                        <div className="w-5 h-5 border-2 border-honey-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}

                    {!isLoading && !detail && (
                      <p className="text-xs text-stone-400 text-center py-4">
                        Couldn't load details for this species.
                      </p>
                    )}

                    {detail && (
                      <>
                        {t.notes && (
                          <p className="text-xs text-stone-500 dark:text-stone-400">{t.notes}</p>
                        )}

                        <button
                          onClick={(e) => { e.stopPropagation(); askBuzz(detail.species); }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-honey-500 hover:bg-honey-600 text-white text-xs font-medium transition-colors"
                        >
                          <MessageCircle size={14} /> Ask Buzz about this
                        </button>

                        {detail.hasKnowledge ? (
                          <>
                            <div className="flex items-center justify-between text-[10px] text-stone-500">
                              <span className="inline-flex items-center gap-1.5 font-medium">
                                <Quote size={11} /> What Jamie Ellis says
                              </span>
                              <span className="text-stone-400">
                                Ep {detail.episodes.join(', ')} · {detail.claimCount} claims
                              </span>
                            </div>
                            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                              {detail.claims.map((c, i) => {
                                const qkey = `${t.species_id}:${i}`;
                                const isQuoteOpen = expandedQuotes.has(qkey);
                                return (
                                  <div
                                    key={qkey}
                                    className="text-xs rounded-lg border border-stone-200 dark:border-stone-800 p-2.5 space-y-1"
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className="text-stone-700 dark:text-stone-200 flex-1">{c.claim}</span>
                                      <span className="text-[10px] text-stone-400 shrink-0 mt-0.5">
                                        {Math.round((c.confidence ?? 0) * 100)}%
                                      </span>
                                    </div>
                                    {c.context && (
                                      <div className="text-[10px] text-stone-400 italic">{c.context}</div>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <button
                                        onClick={() => toggleQuote(qkey)}
                                        className="text-[10px] text-honey-600 dark:text-honey-300 hover:underline"
                                      >
                                        {isQuoteOpen ? 'Hide source quote' : 'Show source quote'}
                                      </button>
                                      {c.youtube_url && (
                                        <a
                                          href={c.youtube_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          title="Watch this moment on YouTube"
                                          className="text-[10px] text-stone-400 hover:text-honey-600 dark:hover:text-honey-300 inline-flex items-center gap-1"
                                        >
                                          <PlayCircle size={11} /> Ep {c.episode} · {fmtTime(c.start_s)}
                                        </a>
                                      )}
                                    </div>
                                    {isQuoteOpen && (
                                      <div className="text-[10px] text-stone-500 dark:text-stone-400 border-l-2 border-honey-300 dark:border-honey-800 pl-2 italic">
                                        "{c.quote}"
                                        {!c.youtube_url && (
                                          <div className="not-italic text-stone-400 mt-0.5">
                                            — Ep {c.episode}{c.kind ? ` · ${c.kind}` : ''}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : threatError[t.species_id] ? (
                          <div className="text-xs text-red-600 dark:text-red-300 text-center py-3">
                            {threatError[t.species_id]}
                            <button
                              onClick={() => openThreat(t.species_id)}
                              className="block mx-auto mt-1 underline"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-stone-400 text-center py-3">
                            No cited knowledge yet — this species is in the catalog but no episode covers it.
                            Ask Buzz directly.
                          </p>
                        )}

                        {detail.relatedSpecies.length > 0 && (
                          <div>
                            <div className="text-[10px] text-stone-500 mb-1.5 inline-flex items-center gap-1.5 font-medium">
                              <Link2 size={11} /> Related species
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {detail.relatedSpecies.map((r) => (
                                <button
                                  key={`${r.species_id}-${r.predicate}`}
                                  onClick={() => openThreat(r.species_id)}
                                  className="text-[10px] text-stone-600 dark:text-stone-300 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 dark:border-stone-800 hover:border-honey-300 hover:text-honey-600 dark:hover:text-honey-300"
                                >
                                  <span className="font-medium">{r.name}</span>
                                  <span className="font-mono text-honey-600 dark:text-honey-300">{r.predicate}</span>
                                  <span className="text-stone-400">{Math.round((r.confidence ?? 0) * 100)}%</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
