// server/ontology.ts — ontology persistence + lookups for Beetree.
//
// Single source of truth: server/ontology/beetree-vocab.yaml (js-yaml).
// On boot we:
//   1. load the vocab
//   2. create the onto_* tables if missing (idempotent DDL)
//   3. upsert threat-species catalog + aliases + default season windows
// Agents then call these fns instead of hand-rolling SQL.
//
// Why this exists:
//   - Buzz should reason over typed entities (Colony/SwarmEvent/ThreatSpecies),
//     not prompt-stuffed prose. Hallucination containment via validation.
//   - A year of data → per-hive behavioral graphs (phenotype → selection advice).
//   - Federated sharing needs shared vocabulary — typed entities, not vibes.

import { db, genId, now } from './db.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — js-yaml has own types
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = join(__dirname, 'ontology', 'beetree-vocab.yaml');

// ─── Types ───────────────────────────────────────────────────────────────────
export interface VocabClass {
  extends?: string;
  parent_of?: string[];
  description?: string;
  inferred_states?: string[];
  headed_by?: string[];
  events?: string[];
  observed_via?: string[];
  phase?: { enum?: string[] };
  kind?: { enum?: string[] };
  vector_of?: string[];
}
export interface VocabRelation { inverse?: string; }
export interface ThreatSpeciesSeed {
  id: string; name: string; scientific?: string;
  kind: 'pest'|'parasite'|'disease'|'commensal';
  vectors?: string[]; vectored_by?: string[];
  notifiable?: boolean; notes?: string;
}
export interface Vocab {
  name: string; version: string; schema_version: string;
  classes: Record<string, VocabClass>;
  relations: Record<string, VocabRelation>;
  season_phase_inference: Record<string, { months: number[]; mean_temp_band_c?: [number, number] }>;
  threat_aliases: Record<string, string>;
  threat_species: ThreatSpeciesSeed[];
  undefined_behavior: Record<string, string>;
}
export interface OntoEntity {
  entity_id: string; entity_type: string; name: string|null;
  properties: Record<string, unknown>; source_table?: string|null; source_id?: string|null;
}
export interface OntoRelationRow {
  entity_id: string; subject_id: string; predicate: string; object_id: string;
  confidence: number; evidence: string[];
}

let vocabCache: Vocab | null = null;

export function loadVocab(): Vocab {
  if (!vocabCache) vocabCache = (yaml.load(readFileSync(VOCAB_PATH, 'utf8')) as Vocab);
  return vocabCache;
}

// ─── Table creation (idempotent; mirrors 006_ontology.sql) ──────────────────
export function ensureOntologySchema(): void {
  // Idempotent runs of the ontology DDL are handled by the migration runner
  // (migrations/006_ontology.sql) when db.ts imports migrate.js.
  // Kept empty: older callers may invoke this path defensively.
}

// ─── Seeders ─────────────────────────────────────────────────────────────────
function upsertCurrent(
  table: string,
  entityId: string,
  patch: Record<string, unknown>,
): void {
  const cols = Object.keys(patch);
  const placeholders = cols.map(() => '?').join(',');
  const sel = db.prepare(`SELECT * FROM ${table} WHERE entity_id = ? AND superseded_by IS NULL`);
  const old = sel.get(entityId) as any;
  if (!old) {
    const rowId = genId('onto');
    db.prepare(
      `INSERT INTO ${table} (id, entity_id, version, superseded_by, superseded_at, created_at, ${cols.join(',')})
       VALUES (?, ?, 1, NULL, NULL, ?, ${placeholders})`
    ).run(rowId, entityId, now(), ...cols.map(c => patch[c]));
    return;
  }
  // Only bump version if any col differs
  const changed: Record<string, unknown> = {};
  let any = false;
  for (const c of cols) {
    const a = (patch as any)[c];
    const b = (old as any)[c];
    if (JSON.stringify(a) !== JSON.stringify(b)) { changed[c] = a; any = true; }
  }
  if (!any) return;
  const newRowId = genId('onto');
  // Mark old superseded FIRST so UNIQUE-partial indexes on current rows
  // don't see a moment with two versions live.
  db.prepare(`UPDATE ${table} SET superseded_by = ?, superseded_at = ? WHERE id = ?`).run(newRowId, now(), old.id);
  const existing = Object.keys(old).filter(k => !['id','entity_id','version','superseded_by','superseded_at','created_at'].includes(k) && !cols.includes(k));
  const allCols = [...cols, ...existing];
  const ph = allCols.map(() => '?').join(',');
  const vals = allCols.map(c => {
    if (cols.includes(c)) return (patch as any)[c];
    return (old as any)[c];
  });
  db.prepare(
    `INSERT INTO ${table} (id, entity_id, version, superseded_by, superseded_at, created_at, ${allCols.join(',')})
     VALUES (?, ?, ?, NULL, NULL, ?, ${ph})`
  ).run(newRowId, entityId, (old.version||1)+1, now(), ...vals);
  // Fix up the superseded_by pointer to reference the correct row id.
  db.prepare(`UPDATE ${table} SET superseded_by = ? WHERE id = ?`).run(newRowId, old.id);
}

export function seedThreatCatalog(): { seeded: number; aliases: number } {
  const v = loadVocab();
  let seeded = 0, aliases = 0;
  for (const s of v.threat_species) {
    upsertCurrent('onto_threat_species', s.id, {
      species_id: s.id,
      name: s.name,
      scientific: s.scientific ?? null,
      kind: s.kind,
      vectors: JSON.stringify(s.vectors ?? []),
      vectored_by: JSON.stringify(s.vectored_by ?? []),
      notifiable: s.notifiable ? 1 : 0,
      notes: s.notes ?? null,
    });
    seeded++;
  }
  for (const [alias, speciesId] of Object.entries(v.threat_aliases)) {
    upsertCurrent('onto_threat_alias', `alias:${alias}`, {
      alias, species_id: speciesId,
    });
    aliases++;
  }
  return { seeded, aliases };
}

export function seedSeasonWindows(siteKey = 'default'): void {
  const v = loadVocab();
  for (const [phase, cfg] of Object.entries(v.season_phase_inference)) {
    const months = cfg.months;
    const start = Math.min(...months);
    const end = Math.max(...months);
    const [mn, mx] = cfg.mean_temp_band_c ?? [null as any, null as any];
    upsertCurrent('onto_season_window', `${siteKey}:${phase}`, {
      site_key: siteKey,
      phase,
      month_start: start,
      month_end: end,
      mean_temp_min_c: mn,
      mean_temp_max_c: mx,
      source: 'vocab',
    });
  }
}

export function initOntology(): { catalog: { seeded: number; aliases: number }; vocab: { name: string; version: string; schema_version: string } } {
  ensureOntologySchema();
  const catalog = seedThreatCatalog();
  seedSeasonWindows('default');
  const v = loadVocab();
  return { catalog, vocab: { name: v.name, version: v.version, schema_version: v.schema_version } };
}

// ─── Lookups ────────────────────────────────────────────────────────────────
export function lookupThreatSpecies(name: string): { found: any; alias?: string } {
  const q = name.toLowerCase().trim();
  const norm = q.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const direct = db.prepare(
    `SELECT * FROM onto_threat_species WHERE superseded_by IS NULL AND (lower(species_id)=? OR lower(name)=? OR lower(scientific)=?)`
  ).get(norm, norm, norm) as any;
  if (direct) return { found: direct, alias: norm };
  const al = db.prepare(`SELECT * FROM onto_threat_alias WHERE superseded_by IS NULL AND alias=?`).get(norm) as any;
  if (al) {
    const species = getThreatSpecies(al.species_id);
    return { found: species, alias: norm };
  }
  const strip = (s: string) => s.replace(/s$/, '');
  const maybe = db.prepare(`SELECT * FROM onto_threat_species WHERE superseded_by IS NULL AND lower(replace(name,' ','_'))=?`).get(strip(norm)) as any;
  return { found: maybe ?? null, alias: norm };
}

export function getThreatSpecies(speciesId: string) {
  return db.prepare(
    `SELECT * FROM onto_threat_species WHERE species_id = ? AND superseded_by IS NULL`
  ).get(speciesId) as any;
}

export function listThreatSpecies(kind?: string) {
  const q = kind ? `AND kind = ?` : '';
  const args = kind ? [kind] : [];
  return db.prepare(
    `SELECT * FROM onto_threat_species WHERE superseded_by IS NULL ${q} ORDER BY kind, name`
  ).all(...args) as any[];
}

// ─── Entities & relations ───────────────────────────────────────────────────
export function upsertEntity(e: Omit<OntoEntity,'entity_id'> & Partial<Pick<OntoEntity,'entity_id'>>): string {
  const id = e.entity_id ?? genId(`onto_${(e.entity_type||'entity').toLowerCase()}`);
  upsertCurrent('onto_entity', id, {
    entity_type: e.entity_type,
    name: e.name ?? null,
    properties: JSON.stringify(e.properties ?? {}),
    source_table: e.source_table ?? null,
    source_id: e.source_id ?? null,
  });
  return id;
}

export function getEntity(entityId: string): any {
  const r = db.prepare(`SELECT * FROM onto_entity WHERE entity_id = ? AND superseded_by IS NULL`).get(entityId) as any;
  if (r?.properties) r.properties = JSON.parse(r.properties);
  return r;
}

export function findEntities(entityType?: string, q?: string): any[] {
  let where = 'superseded_by IS NULL';
  const args: any[] = [];
  if (entityType) { where += ' AND entity_type = ?'; args.push(entityType); }
  if (q) { where += ' AND (name LIKE ?)'; args.push(`%${q}%`); }
  return db.prepare(`SELECT * FROM onto_entity WHERE ${where} ORDER BY entity_type, name`).all(...args) as any[];
}

const VALID_PREDICATES = new Set<string>();
export function knownPredicates(): Set<string> {
  if (VALID_PREDICATES.size === 0) {
    for (const p of Object.keys(loadVocab().relations)) VALID_PREDICATES.add(p);
  }
  return VALID_PREDICATES;
}

export function addRelation(subjectId: string, predicate: string, objectId: string, evidence: string[] = []): { ok: boolean; reason?: string } {
  if (!knownPredicates().has(predicate)) {
    return { ok: false, reason: `Unknown predicate '${predicate}' — defined: ${[...knownPredicates()].join(', ')}` };
  }
  const id = `${subjectId}|${predicate}|${objectId}`;
  upsertCurrent('onto_relation', id, {
    subject_id: subjectId,
    predicate,
    object_id: objectId,
    confidence: 1.0,
    evidence: JSON.stringify(evidence),
  });
  return { ok: true };
}

export function getRelationsFor(entityId: string): OntoRelationRow[] {
  const rows = db.prepare(
    `SELECT * FROM onto_relation WHERE superseded_by IS NULL AND (subject_id = ? OR object_id = ?)`
  ).all(entityId, entityId) as any[];
  for (const r of rows) r.evidence = JSON.parse(r.evidence || '[]');
  return rows;
}

export function getEntityGraph(entityId: string): { node: any; edges: OntoRelationRow[]; neighbors: any[] } {
  const node = getEntity(entityId);
  if (!node) return { node: null, edges: [], neighbors: [] };
  const edges = getRelationsFor(entityId);
  const ids = new Set<string>();
  for (const e of edges) { ids.add(e.subject_id); ids.add(e.object_id); }
  ids.delete(entityId);
  const neighbors = [...ids].map(i => getEntity(i)).filter(Boolean);
  return { node, edges, neighbors };
}

// ─── Events & instantiations (the colony-state ledger) ──────────────────────
export function recordEvent(opts: {
  event_type: string;
  subject_id: string;
  occurred_at?: string;
  ended_at?: string;
  properties?: Record<string, unknown>;
  confidence?: number;
}): string {
  const id = genId(`onto_ev_${opts.event_type.toLowerCase()}`);
  const occurredAt = opts.occurred_at ?? now();
  db.prepare(`INSERT INTO onto_event (id, entity_id, version, superseded_by, superseded_at, created_at, event_type, subject_id, occurred_at, ended_at, properties, confidence)
    VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, now(), opts.event_type, opts.subject_id, occurredAt, opts.ended_at ?? null, JSON.stringify(opts.properties ?? {}), opts.confidence ?? 1.0);
  return id;
}

export function recordInstantiation(opts: {
  state_class: string;
  subject_id: string;
  valid_from?: string;
  valid_to?: string;
  confidence?: number;
  supporting_evidence?: string[];
  rationale?: string;
}): string {
  const id = genId(`onto_st_${opts.state_class.toLowerCase()}`);
  const validFrom = opts.valid_from ?? now();
  // close prior current state on same subject + class
  db.prepare(`UPDATE onto_instantiation SET valid_to = ? WHERE subject_id = ? AND state_class = ? AND valid_to IS NULL AND superseded_by IS NULL`)
    .run(validFrom, opts.subject_id, opts.state_class);
  db.prepare(`INSERT INTO onto_instantiation (id, entity_id, version, superseded_by, superseded_at, created_at, state_class, subject_id, valid_from, valid_to, confidence, supporting_evidence, rationale)
    VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, now(), opts.state_class, opts.subject_id, validFrom, opts.valid_to ?? null, opts.confidence ?? 0.5, JSON.stringify(opts.supporting_evidence ?? []), opts.rationale ?? null);
  return id;
}

export function currentState(subjectId: string): any[] {
  return db.prepare(
    `SELECT * FROM onto_instantiation WHERE subject_id = ? AND valid_to IS NULL AND superseded_by IS NULL`
  ).all(subjectId) as any[];
}

export function getSeasonPhaseFor(dateISO: string, siteKey = 'default'): { phase: string | null } {
  const d = new Date(dateISO);
  const m = d.getUTCMonth() + 1;
  const rows = db.prepare(`SELECT * FROM onto_season_window WHERE superseded_by IS NULL AND site_key = ?`).all(siteKey) as any[];
  for (const r of rows) {
    const s = r.month_start, e = r.month_end;
    if (s <= e ? m >= s && m <= e : m >= s || m <= e) {
      return { phase: r.phase };
    }
  }
  return { phase: null };
}

export function getUndefinedBehavior(key: keyof Vocab['undefined_behavior']): string {
  return loadVocab().undefined_behavior[key] ?? '';
}
