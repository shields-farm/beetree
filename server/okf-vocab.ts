// server/okf-vocab.ts — the vocabulary, read from the OKF bundle.
//
// Split out of ontology.ts so the bundle reader has no database dependency: the
// vocab is pure parsed knowledge, and keeping it separate is what lets the parity
// check and the tests load it without opening SQLite.
//
// OKF v0.2 is the canonical form (it replaced server/ontology/beetree-vocab.yaml).
// One concept per file; frontmatter carries the queryable fields, the body the
// prose. Inference rules name their block in `method` and their legacy YAML key in
// `key`, so the five differential blocks rebuild keyed exactly as before.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundle, sections, type OkfConcept } from './okf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** The OKF bundle that replaced beetree-vocab.yaml (repo root, next to server/). */
export const VOCAB_DIR = join(__dirname, '..', 'okf');

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
  kind: 'pest'|'parasite'|'disease'|'commensal'|'predator';
  vectors?: string[]; vectored_by?: string[];
  notifiable?: boolean; notes?: string;
  severity?: string; region?: string;
}
export interface VocabIndication {
  state: string;
  confidence?: number;
  reason?: string;
}
/** One observation → candidate states, with the operational notes attached. */
export interface VocabInferenceCue {
  description?: string;
  indicates?: VocabIndication[];
  notes?: string;
  /** comb_inference only: brood-cycle age band. */
  age_cycles?: number | string;
  /** comb_inference only: what to do about it. */
  action?: string;
  /** burr_comb only: ranked causes with confidences. */
  causes?: { cause: string; confidence?: number; notes?: string }[];
}
export interface Vocab {
  name: string; version: string; schema_version: string;
  classes: Record<string, VocabClass>;
  relations: Record<string, VocabRelation>;
  season_phase_inference: Record<string, { months: number[]; mean_temp_band_c?: [number, number] }>;
  // Differential-diagnosis blocks. These are the knowledge the onto_* tools do
  // NOT carry, and they are what server/inference.ts reads to turn a frame
  // observation into ranked, checked candidates.
  brood_inference?: Record<string, VocabInferenceCue>;
  comb_inference?: Record<string, VocabInferenceCue>;
  queen_inference?: Record<string, VocabInferenceCue>;
  varroa_inference?: Record<string, VocabInferenceCue>;
  deadout_inference?: Record<string, Record<string, unknown>>;
  threat_aliases: Record<string, string>;
  threat_species: ThreatSpeciesSeed[];
  undefined_behavior: Record<string, string>;
}

let vocabCache: Vocab | null = null;

/** Parse `- **\`key\`** — text` rows into a contract map. */
function parseBehavior(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const row = /^-\s+\*\*`([^`]+)`\*\*\s+—\s+(.*)$/gm;
  for (const m of body.matchAll(row)) out[m[1]] = m[2].trim();
  return out;
}

/**
 * Rebuild the vocabulary from OKF concepts.
 *
 * Unknown types and unknown frontmatter keys are ignored, never rejected — OKF
 * requires a consumer to tolerate both.
 */
export function buildVocab(concepts: OkfConcept[]): Vocab {
  const classes: Record<string, VocabClass> = {};
  const relations: Record<string, VocabRelation> = {};
  const season_phase_inference: Vocab['season_phase_inference'] = {};
  const blocks: Record<string, Record<string, any>> = {
    brood_inference: {}, comb_inference: {}, queen_inference: {},
    varroa_inference: {}, deadout_inference: {},
  };
  const threat_species: ThreatSpeciesSeed[] = [];
  let threat_aliases: Record<string, string> = {};
  let undefined_behavior: Record<string, string> = {};
  let name = 'beetree-vocab', version = '0.0.0', schema_version = '';

  for (const c of concepts) {
    const fm = c.frontmatter;
    const sec = sections(c.body);
    switch (fm.type) {
      case 'Knowledge Bundle':
        name = fm.name ?? name;
        version = String(fm.version ?? version);
        schema_version = String(fm.schema_version ?? schema_version);
        break;

      case 'Ontology Class': {
        const key: string = fm.key ?? fm.title;
        if (!key) break;
        const cls: VocabClass = {};
        if (fm.extends) cls.extends = fm.extends;
        if (fm.description) cls.description = fm.description;
        for (const k of ['parent_of', 'emits', 'inferred_states', 'headed_by', 'events', 'observed_via', 'vector_of'] as const) {
          if (fm[k]) (cls as any)[k] = fm[k];
        }
        if (fm.kind_enum) cls.kind = { enum: fm.kind_enum };
        if (fm.phase_enum) cls.phase = { enum: fm.phase_enum };
        classes[key] = cls;
        break;
      }

      case 'Ontology Relation': {
        const key: string = fm.key ?? fm.title;
        if (key) relations[key] = fm.inverse ? { inverse: fm.inverse } : {};
        break;
      }

      case 'Season Window': {
        const key: string = fm.key ?? fm.title;
        if (key) {
          season_phase_inference[key] = {
            months: fm.months ?? [],
            ...(fm.mean_temp_band_c ? { mean_temp_band_c: fm.mean_temp_band_c } : {}),
          };
        }
        break;
      }

      case 'Inference Rule': {
        const block: string = fm.method;
        const key: string = fm.key;
        if (!block || !key || !blocks[block]) break;
        const cue: VocabInferenceCue = {};
        if (fm.description) cue.description = fm.description;
        if (Array.isArray(fm.candidates)) {
          cue.indicates = fm.candidates.map((x: any) => ({
            state: x.state,
            ...(x.confidence !== undefined ? { confidence: x.confidence } : {}),
            ...(x.reason ? { reason: x.reason } : {}),
          }));
        }
        if (fm.age_cycles !== undefined) cue.age_cycles = fm.age_cycles;
        if (fm.action) cue.action = fm.action;
        if (Array.isArray(fm.causes)) cue.causes = fm.causes;
        if (sec.Notes) cue.notes = sec.Notes;
        // deadout_inference keeps its own shape (diagnosis, not indications).
        blocks[block][key] = fm.diagnosis ? { ...cue, diagnosis: fm.diagnosis } : cue;
        break;
      }

      case 'Threat Species': {
        const id: string = fm.key ?? fm.title;
        if (!id) break;
        threat_species.push({
          id,
          name: fm.title ?? id,
          ...(fm.scientific_name ? { scientific: fm.scientific_name } : {}),
          kind: fm.kind ?? 'pest',
          ...(fm.vectors ? { vectors: fm.vectors } : {}),
          ...(fm.vectored_by ? { vectored_by: fm.vectored_by } : {}),
          ...(fm.notifiable ? { notifiable: true } : {}),
          ...(fm.severity ? { severity: fm.severity } : {}),
          ...(fm.region ? { region: fm.region } : {}),
          // `notes` exists only when the source had notes — never synthesised
          // from the description, so absent stays absent.
          ...(sec.Notes ? { notes: sec.Notes } : {}),
        });
        // Aliases belong to the thing named, so they ride on the species concept
        // and the resolver index is built by inverting them here. The
        // `threats/aliases` concept is a human-readable index of the same map.
        for (const a of fm.aliases ?? []) threat_aliases[a] = id;
        break;
      }

      case 'Behavior Contract':
        undefined_behavior = parseBehavior(c.body);
        break;
    }
  }

  threat_species.sort((a, b) => a.id.localeCompare(b.id));
  return {
    name, version, schema_version,
    classes, relations, season_phase_inference,
    brood_inference: blocks.brood_inference,
    comb_inference: blocks.comb_inference,
    queen_inference: blocks.queen_inference,
    varroa_inference: blocks.varroa_inference,
    deadout_inference: blocks.deadout_inference,
    threat_aliases, threat_species, undefined_behavior,
  };
}

/** Load the OKF bundle once per process. */
export function loadVocab(): Vocab {
  if (!vocabCache) vocabCache = buildVocab(readBundle(VOCAB_DIR));
  return vocabCache;
}
