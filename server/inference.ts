// server/inference.ts — map a frame observation to the ontology's diagnostic rules.
//
// This is the join that did not exist. `server/vision.ts` returns a structured
// FrameAnalysis and stops; `server/ontology/beetree-vocab.yaml` carries weighted
// differential rules (brood_inference / queen_inference / varroa_inference) that
// nothing ever read. So a photo could say `broodPattern: "spotty"` and the system
// would never surface that the vocab calls that Queenright 0.25 / Queenless 0.20 /
// Dwindling 0.15 and *explicitly* says do not conclude — check varroa, then eggs,
// then disease, then pesticide, then cold snap.
//
// Confidence semantics
// --------------------
// The vocab confidences are calibrated for a HUMAN observation: "I looked at this
// comb and the brood is spotty." A vision model reading one photo is weaker
// evidence, and the failure modes are not small — glare, bees covering the
// pattern, fixed-focus cameras that cannot resolve eggs.
//
// So we do not pass the vocab number through as-is. Each cue's confidence is
// multiplied by a per-cue evidence weight in [0,1] that encodes how reliably a
// single photo supports that specific cue:
//
//   * negative findings (absence of eggs/larvae/capped brood) get LOW weight —
//     "I didn't see it" is not "it isn't there", and Jamie's own objection is that
//     the resolution is not there for eggs;
//   * positive findings a model can genuinely see (capped brood at the top of a
//     frame, an oval queen among workers) get higher weight;
//   * cues that need a scale reference or a second frame (comb colour as a proxy
//     for brood-cycle age) are suppressed to a floor rather than trusted.
//
// A state is only reported as `supported` when the weighted confidence clears
// MIN_SUPPORTED. Everything else is reported as a candidate with its checks
// outstanding. Under-claiming is the point: over-claiming is what would make the
// ontology lie to a beekeeper.

import { loadVocab } from './ontology.js';
import type { FrameAnalysis } from './vision.js';

/** A candidate for a state, always carrying what still needs checking. */
export interface InferenceCandidate {
  state: string;
  /** Weighted confidence in [0,1] — vocab confidence x evidence weight. */
  confidence: number;
  /** Raw confidence from the vocab, before evidence weighting. */
  vocabConfidence: number;
  /** The cue key in the vocab that produced this candidate. */
  cue: string;
  /** Which vocab block the cue came from. */
  block: string;
  /** Why the vocab says this state is indicated, when it gives a reason. */
  reason?: string;
  /** How well a single photo supports this cue, in [0,1]. */
  evidenceWeight: number;
  /** Differential checks the vocab requires before concluding. */
  checks: string[];
  notes?: string;
}

export interface InferenceResult {
  candidates: InferenceCandidate[];
  /** Highest weighted confidence per state, descending. */
  ranked: InferenceCandidate[];
  /** States clearing MIN_SUPPORTED, with their checks. */
  supported: InferenceCandidate[];
  /** The best candidate when nothing clears MIN_SUPPORTED. */
  lead: InferenceCandidate | null;
  /** Phenological phase for the capture time. */
  seasonPhase: string | null;
  /** True when the top candidate is below MIN_SUPPORTED. */
  lowConfidence: boolean;
  /** Human-readable notes the vocab attaches to the matched cues. */
  vocabNotes: string[];
  /** Every cue key that matched, in the order they were evaluated. */
  matchedCues: string[];
}

/** A weighted confidence at or above this is stated as supported. */
export const MIN_SUPPORTED = 0.6;

/** Confidence floor — below this a cue is not worth surfacing at all. */
const MIN_REPORTABLE = 0.05;

type VocabIndication = { state: string; confidence?: number; reason?: string };
type VocabCue = { description?: string; indicates?: VocabIndication[]; notes?: string };

interface InferenceBlocks {
  brood_inference?: Record<string, VocabCue>;
  queen_inference?: Record<string, VocabCue>;
  varroa_inference?: Record<string, VocabCue>;
}

function blocks(): InferenceBlocks {
  return loadVocab() as unknown as InferenceBlocks;
}

// ─── Differential checklists ────────────────────────────────────────────────
// Transcribed from the vocab's `spotty_mixed` notes, which are the operational
// heart of the differential. Kept in code so every spotty-brood result carries
// them, rather than only the candidates that happen to match a named cue.

const CHECKS_SPOTTY = [
  'Varroa: alcohol wash or sugar shake. High mite load + spotty brood = virus.',
  'Queen: look for eggs. No eggs + spotty = queen failing or gone.',
  'Disease: smell (AFB = rotten), rope test, check for chalkbrood mummies.',
  'Pesticide: ask about recent spraying in the area.',
  'Cold snap: if a recent dip below 10°C during brood rearing, suspect cold-damaged brood.',
];

const CHECKS_DRONE = [
  'Single egg per cell, orderly pattern → drone-laying queen: requeen immediately.',
  'Multiple eggs per cell, eggs on cell walls → laying workers: combine, requeening almost always fails.',
];

const CHECKS_QUEENLESS = [
  'Look for queen cells — if present the colony is requeening itself.',
  'Re-inspect frames you did not fully pull before concluding she is gone.',
  'If no queen, no eggs, no cells: add a frame of eggs/young larvae from another colony and re-check in 3-5 days.',
];

const CHECKS_VARROA = [
  'Confirm with an alcohol wash or sugar shake — visual symptoms appear late, the damage is already done.',
  'If mite load >2%: treat. If >5%: colony is in crisis.',
  'Choose a treatment that matches the season (formic acid during flow, thymol after).',
];

const CHECKS_RESOLUTION = [
  'Eggs and young larvae are at the resolution limit of a single photo. Re-check on the frame before trusting the absence.',
];

// ─── Evidence weights ───────────────────────────────────────────────────────
// How far a single frame photo can be trusted for each cue. Anything not listed
// falls back to DEFAULT_EVIDENCE_WEIGHT.

const DEFAULT_EVIDENCE_WEIGHT = 0.7;

const EVIDENCE_WEIGHT: Record<string, number> = {
  // Brood layout: broadly legible from a photo when the frame is lit and clear.
  solid_capped: 0.9,
  solid_scattered_uncapped: 0.75,
  spotty_mixed: 0.85,
  spotty_drone_dominant: 0.8,
  center_cluster_only: 0.7,
  peripheral_brood: 0.6,
  drone_only_pupal: 0.7,
  absent: 0.35, // absence needs the whole frame in view — rarely true

  // Queen cues. Spotting the queen is a genuinely visual task; not spotting her
  // says almost nothing, and eggs are beyond what one photo resolves.
  queen_spotted_marked: 0.85,
  queen_spotted_unmarked: 0.8,
  eggs_present_single: 0.35,
  eggs_present_multiple_per_cell: 0.3,
  queen_not_found_eggs_present: 0.5,
  queen_not_found_no_eggs: 0.25,
  virgin_queen: 0.25,
  swarm_cells: 0.8,
  supersedure_cells: 0.65,
  emergency_cells: 0.7,
  queen_capped: 0.7,
  queen_cups_empty: 0.55,
  no_queen_no_eggs_no_cells: 0.2,

  // Varroa symptoms are visible but easy to over-read from a compressed frame.
  deformed_wings: 0.7,
  k_wing: 0.45,
  hairless_black_bees: 0.55,
  phoretic_mites_visible: 0.4, // varroa sit on the underside — a photo rarely proves them
  parasitic_mite_syndrome: 0.75,
  no_visible_symptoms: 0.2,
};

// ─── Cue matching ───────────────────────────────────────────────────────────

const DISEASE_CUE: Record<string, string> = {
  deformed_wing_virus: 'deformed_wings',
  dwv: 'deformed_wings',
  deformed_wings: 'deformed_wings',
  k_wing: 'k_wing',
  kwing: 'k_wing',
  chronic_bee_paralysis_virus: 'hairless_black_bees',
  chronic_bee_paralysis: 'hairless_black_bees',
  cbpv: 'hairless_black_bees',
  parasitic_mite_syndrome: 'parasitic_mite_syndrome',
  pms: 'parasitic_mite_syndrome',
};

const PEST_CUE: Record<string, string> = {
  varroa: 'phoretic_mites_visible',
  varroa_destructor: 'phoretic_mites_visible',
  varroa_mite: 'phoretic_mites_visible',
  varroa_mites: 'phoretic_mites_visible',
};

/**
 * Normalize a free-text label to a cue-lookup key.
 *
 * The model returns labels like "Deformed wing virus (DWV)" while the cue map is
 * keyed on "deformed_wing_virus". Both sides must go through this or the lookup
 * silently misses — which is exactly what it did: DWV never reached the varroa
 * block, so the highest-signal finding a frame can carry was being discarded.
 */
function cueKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * True when the analysis carries at least one positive observation.
 *
 * Used to decide whether we have a reading at all. "The model looked and could
 * not tell" is not an observation, and must not be turned into a low-confidence
 * diagnosis — the vocab's own undefined_behavior says state plainly rather than
 * guess.
 */
export function hasObservableEvidence(a: FrameAnalysis): boolean {
  return a.broodPattern !== 'unknown'
    || a.queenSpotted
    || a.cappedBroodPresent
    || a.eggsVisible
    || a.larvaeVisible
    || a.diseases.length > 0
    || a.pests.length > 0;
}

function looksLike(name: string, ...needles: string[]): boolean {
  const k = cueKey(name);
  return needles.some((n) => k.includes(n));
}

/**
 * Choose the brood_inference cue from the vision model's broodPattern plus the
 * brood-stage flags. The vocab distinguishes drone-dominant spotting from mixed
 * spotting, which the vision model does not report directly — so we only take the
 * drone branch when the model says so in its own words.
 */
function broodCue(a: FrameAnalysis): string | null {
  const droneSignal = looksLike(a.overallAssessment ?? '', 'drone')
    || a.pests.some((p) => looksLike(p.note ?? '', 'drone'))
    || a.diseases.some((d) => looksLike(d.note ?? '', 'drone'))
    || a.concerns.some((c) => looksLike(c.note ?? '', 'drone') || looksLike(c.type ?? '', 'drone'));

  switch (a.broodPattern) {
    case 'solid':
      return a.cappedBroodPresent || a.larvaeVisible || a.eggsVisible
        ? 'solid_capped'
        : 'solid_scattered_uncapped';
    case 'spotty':
      return droneSignal ? 'spotty_drone_dominant' : 'spotty_mixed';
    case 'patchy':
      return droneSignal ? 'drone_only_pupal' : 'spotty_mixed';
    case 'none':
      return 'absent';
    default:
      return null;
  }
}

/** Choose the queen_inference cue from what the model reported on the queen. */
function queenCue(a: FrameAnalysis): string | null {
  if (a.queenCellsVisible) {
    // Position is what separates swarm from supersedure from emergency cells.
    const loc = cueKey(a.queenLocation ?? '');
    if (loc.includes('bottom') || loc.includes('edge') || loc.includes('lower')) return 'swarm_cells';
    if (loc.includes('face') || loc.includes('center') || loc.includes('middle')) return 'supersedure_cells';
    return 'queen_capped';
  }
  if (a.queenSpotted) {
    const m = /mark|dot|paint/i.test(a.queenLocation ?? '');
    return m ? 'queen_spotted_marked' : 'queen_spotted_unmarked';
  }
  // Open brood (eggs/larvae) means she laid within the last few days.
  if (a.eggsVisible || a.larvaeVisible) return 'queen_not_found_eggs_present';
  if (a.broodPattern === 'none') return 'no_queen_no_eggs_no_cells';
  // Capped brood alone does NOT mean eggs are present. It means she was laying
  // roughly 9-20 days ago, which says nothing about now. Mapping this to
  // `queen_not_found_eggs_present` would assert an observation we never made and
  // inflate the Queenright confidence accordingly — so we report what we actually
  // saw, and the vocab's own wide-open split (Queenless 0.35 / Queenright 0.20)
  // is the correct answer.
  return 'queen_not_found_no_eggs';
}

function checksFor(block: string, cue: string): string[] {
  const checks: string[] = [];
  if (cue === 'spotty_mixed' || cue === 'spotty_drone_dominant' || cue === 'drone_only_pupal') {
    checks.push(...CHECKS_SPOTTY);
  }
  if (cue === 'spotty_drone_dominant' || cue === 'drone_only_pupal') checks.push(...CHECKS_DRONE);
  if (cue === 'no_queen_no_eggs_no_cells' || cue === 'queen_not_found_no_eggs' || cue === 'emergency_cells') {
    checks.push(...CHECKS_QUEENLESS);
  }
  if (block === 'varroa_inference') checks.push(...CHECKS_VARROA);
  if (cue === 'eggs_present_single' || cue === 'eggs_present_multiple_per_cell' || cue === 'queen_not_found_no_eggs') {
    checks.push(...CHECKS_RESOLUTION);
  }
  return checks;
}

function pushCandidates(
  out: InferenceCandidate[],
  matches: string[],
  blockKey: keyof InferenceBlocks,
  cueName: string,
  blockMap: Record<string, VocabCue> | undefined,
  notes: string[],
): void {
  const cue = blockMap?.[cueName];
  if (!cue) return;
  matches.push(cueName);
  if (cue.notes) notes.push(cue.notes.trim());
  const weight = EVIDENCE_WEIGHT[cueName] ?? DEFAULT_EVIDENCE_WEIGHT;
  for (const ind of cue.indicates ?? []) {
    const vocabConfidence = typeof ind.confidence === 'number' ? ind.confidence : 0.5;
    const confidence = Math.round(vocabConfidence * weight * 1000) / 1000;
    if (confidence < MIN_REPORTABLE) continue;
    out.push({
      state: ind.state,
      confidence,
      vocabConfidence,
      cue: cueName,
      block: blockKey,
      reason: ind.reason,
      evidenceWeight: weight,
      checks: checksFor(blockKey, cueName),
      notes: cue.notes?.trim(),
    });
  }
}

/**
 * Run every applicable inference block against a FrameAnalysis and return the
 * ranked candidates. Pure function over the vocab — no DB access, no model call.
 */
export function inferFromFrame(a: FrameAnalysis, seasonPhase: string | null = null): InferenceResult {
  const b = blocks();
  const candidates: InferenceCandidate[] = [];
  const matchedCues: string[] = [];
  const vocabNotes: string[] = [];

  // With no positive observation there is nothing to infer from. Returning an
  // empty ranking is the honest answer, and the caller renders it as "couldn't
  // read that frame" rather than as a diagnosis.
  if (!hasObservableEvidence(a)) {
    return {
      candidates: [], ranked: [], supported: [], lead: null,
      seasonPhase, lowConfidence: true, vocabNotes: [], matchedCues: [],
    };
  }

  const bc = broodCue(a);
  if (bc) pushCandidates(candidates, matchedCues, 'brood_inference', bc, b.brood_inference, vocabNotes);

  const qc = queenCue(a);
  if (qc) pushCandidates(candidates, matchedCues, 'queen_inference', qc, b.queen_inference, vocabNotes);

  // Varroa cues come from named diseases/pests, not from the brood pattern.
  const varroaCues = new Set<string>();
  for (const d of a.diseases) {
    const key = cueKey(d.type ?? '');
    if (DISEASE_CUE[key]) varroaCues.add(DISEASE_CUE[key]);
    // Fall back to substring match for free-text labels.
    for (const [needle, mapped] of Object.entries(DISEASE_CUE)) {
      if (key.includes(needle)) varroaCues.add(mapped);
    }
  }
  for (const p of a.pests) {
    const key = cueKey(p.type ?? '');
    for (const [needle, mapped] of Object.entries(PEST_CUE)) {
      if (key.includes(needle)) varroaCues.add(mapped);
    }
  }
  if (varroaCues.has('deformed_wings') && varroaCues.has('phoretic_mites_visible')) {
    varroaCues.add('parasitic_mite_syndrome');
  }
  for (const cue of varroaCues) {
    pushCandidates(candidates, matchedCues, 'varroa_inference', cue, b.varroa_inference, vocabNotes);
  }

  // A cue can indicate the same state twice across blocks (brood and varroa both
  // reach Dwindling). Keep the strongest statement per state — but the same state
  // can also arrive from different cues with different checklists, and dropping
  // the weaker one would drop its checks. So the winner carries the union.
  const bestByState = new Map<string, InferenceCandidate>();
  for (const c of candidates) {
    const cur = bestByState.get(c.state);
    if (!cur) {
      bestByState.set(c.state, c);
      continue;
    }
    const winner = c.confidence > cur.confidence ? c : cur;
    const loser = c.confidence > cur.confidence ? cur : c;
    bestByState.set(c.state, { ...winner, checks: [...new Set([...winner.checks, ...loser.checks])] });
  }
  const ranked = [...bestByState.values()].sort((x, y) => y.confidence - x.confidence);

  const supported = ranked.filter((c) => c.confidence >= MIN_SUPPORTED);

  return {
    candidates,
    ranked,
    supported,
    lead: ranked[0] ?? null,
    seasonPhase,
    lowConfidence: ranked.length === 0 || (ranked[0]?.confidence ?? 0) < MIN_SUPPORTED,
    vocabNotes: [...new Set(vocabNotes)],
    matchedCues,
  };
}

/** The checklists a caller should surface when nothing clears MIN_SUPPORTED. */
export function outstandingChecks(result: InferenceResult): string[] {
  const checks = new Set<string>();
  if (result.lowConfidence) {
    for (const c of result.ranked.slice(0, 3)) for (const ch of c.checks) checks.add(ch);
  }
  return [...checks];
}
