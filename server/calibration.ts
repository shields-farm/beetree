// server/calibration.ts — did the ontology's predictions actually come true?
//
// The loop the rest of the capture path leaves open:
//
//   capture.ts writes a prediction       (inferFromFrame -> recordInstantiation)
//   correction.ts records the truth      (correctCapture -> beekeeper_correction)
//   ...and nothing ever compares them.
//
// So `swarm_cells` has said "SwarmPrep 0.85" since the vocab was written, and no
// row anywhere records whether it was right on *this* apiary. A confidence that
// is never scored is a number we chose, not a number we earned.
//
// This module is the scoring step. It reads the correction rows the capture loop
// already writes, pairs each model candidate against what the beekeeper said, and
// reports per-cue calibration: what we predicted vs. what happened.
//
// Deliberate limits, all in the same direction as the rest of the ontology:
//
//   * We do NOT edit the vocab. `beetree-vocab.yaml` is human-canonical and Mark
//     maintains it by hand. Recalibration is an ADVISORY output — "this cue reads
//     0.85 and has landed 0.40 of 12 observations" — and a human decides.
//   * We do NOT report a rate below MIN_CALIBRATION_SAMPLE. One correction is an
//     anecdote; publishing "100%" off it would be exactly the overclaim the
//     inference layer's under-claiming discipline exists to prevent.
//   * A bucket with no data reports `n = 0` and no rate. Absence of evidence is
//     not a 0% success rate, and the caller must see the difference.
//
// Brier score is the headline number: mean squared error of the probability
// forecast, so it punishes a confident wrong answer harder than a hedged one.
// Lower is better; 0.25 is the score of always saying 0.5, and a cue that scores
// worse than that is actively less useful than a coin flip.

import { db } from './db.js';

/** Below this many observations a bucket is reported as a count, not a rate. */
export const MIN_CALIBRATION_SAMPLE = 5;

/** A prediction paired with the beekeeper's verdict on the same capture. */
export interface CalibrationObservation {
  captureId: string;
  hiveId: string | null;
  capturedAt: string | null;
  /** Which inference block the candidate came from, e.g. `queen_inference`. */
  block: string;
  /** The vocab cue that produced it, e.g. `swarm_cells`. */
  cue: string;
  /** The state the model proposed, e.g. `SwarmPrep`. */
  state: string;
  /** Weighted confidence the model reported, in [0,1]. */
  predicted: number;
  /** What the beekeeper said the true state was. */
  humanState: string;
  /** Whether the model's candidate matched the beekeeper. */
  correct: boolean;
}

/** Per (block, cue, state) calibration — one vocab rule's track record. */
export interface CalibrationBucket {
  block: string;
  cue: string;
  state: string;
  /** Number of observations in this bucket. */
  n: number;
  /** Mean confidence the model reported. Null when n = 0. */
  meanPredicted: number | null;
  /** Fraction of observations where the beekeeper confirmed this state. */
  realizedRate: number | null;
  /** realizedRate - meanPredicted. Positive = the cue under-claims. */
  delta: number | null;
  /** Brier score for this bucket. Null when n = 0. */
  brier: number | null;
  /**
   * Suggested replacement confidence, or null when the bucket is too small or
   * already well calibrated. Advisory only — the vocab is edited by hand.
   */
  advisoryConfidence: number | null;
}

export interface CalibrationReport {
  /** Correction rows examined. */
  corrections: number;
  /** Candidate-vs-verdict pairs derived from them. */
  observations: number;
  /** Top-1 verdict accuracy: did the model's lead candidate match the human? */
  top1: { n: number; agreed: number; rate: number } | null;
  /** Overall Brier across every observation. Null with no data. */
  brier: number | null;
  buckets: CalibrationBucket[];
  /** Buckets held back from a rate because they are under-sampled. */
  underSampled: number;
  minSample: number;
  /** Plain-language readout, including the empty case. */
  note: string;
}

interface CorrectionRow {
  content: string;
  recorded_at: string;
}

/** A candidate as it was serialized into evidence at capture time. */
interface RankedCandidate {
  state?: string;
  cue?: string;
  block?: string;
  confidence?: number;
}

/**
 * Read the correction rows the capture loop already writes and expand each into
 * one observation per candidate the model proposed on that capture.
 *
 * Expanding rather than scoring only the top candidate is deliberate: when the
 * model leads with `SwarmPrep` and the beekeeper says `Queenright`, that is one
 * negative observation for `SwarmPrep` *and* the `SwarmPrep` cue can also be
 * scored on captures where it appeared lower in the ranking. Throwing away the
 * non-top candidates would mean a rare cue could never accumulate evidence.
 */
export function calibrationObservations(limit = 2000): CalibrationObservation[] {
  const rows = db.prepare(
    `SELECT content, recorded_at
       FROM onto_evidence
      WHERE superseded_by IS NULL AND evidence_kind = 'beekeeper_correction'
      ORDER BY recorded_at DESC LIMIT ?`,
  ).all(limit) as CorrectionRow[];

  const out: CalibrationObservation[] = [];
  for (const row of rows) {
    let parsed: any;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      // A malformed payload is not a calibration fact. Skip rather than guess.
      continue;
    }

    const humanState = parsed?.correction?.state;
    if (typeof humanState !== 'string' || !humanState) continue;

    const ranked: RankedCandidate[] = Array.isArray(parsed?.correction?.ai_ranked)
      ? parsed.correction.ai_ranked
      : [];

    for (const c of ranked) {
      if (typeof c?.state !== 'string' || !c.state) continue;
      if (typeof c?.confidence !== 'number' || !Number.isFinite(c.confidence)) continue;
      out.push({
        captureId: parsed?.capture_id ?? '',
        hiveId: parsed?.hive_id ?? null,
        capturedAt: parsed?.captured_at ?? null,
        block: c.block ?? 'unknown',
        cue: c.cue ?? 'unknown',
        state: c.state,
        predicted: c.confidence,
        humanState,
        correct: c.state === humanState,
      });
    }
  }
  return out;
}

/** Round to 3dp so reports are stable across runs and diffable. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Build the calibration report: per-cue track record, top-1 accuracy, and an
 * overall Brier score.
 */
export function calibrationReport(limit = 2000): CalibrationReport {
  const observations = calibrationObservations(limit);
  const corrections = new Set(
    observations.map((o) => o.captureId).filter((id) => id !== ''),
  ).size;

  if (observations.length === 0) {
    return {
      corrections: 0,
      observations: 0,
      top1: null,
      brier: null,
      buckets: [],
      underSampled: 0,
      minSample: MIN_CALIBRATION_SAMPLE,
      note: 'No labelled captures yet. Calibration needs beekeeper corrections to '
        + 'compare against — correct a capture in the app and this fills in.',
    };
  }

  // Group by the vocab rule that produced the prediction.
  const groups = new Map<string, CalibrationObservation[]>();
  for (const o of observations) {
    const k = `${o.block}\u0000${o.cue}\u0000${o.state}`;
    const g = groups.get(k);
    if (g) g.push(o);
    else groups.set(k, [o]);
  }

  const buckets: CalibrationBucket[] = [];
  let underSampled = 0;

  for (const [k, g] of groups) {
    const [block, cue, state] = k.split('\u0000');
    const n = g.length;
    const meanPredicted = mean(g.map((o) => o.predicted));
    const realizedRate = g.filter((o) => o.correct).length / n;
    const brier = mean(g.map((o) => (o.predicted - (o.correct ? 1 : 0)) ** 2));

    // Under-sampled: report the count, withhold the rate. The n is still useful
    // ("this cue has fired twice") without inviting a false precision.
    if (n < MIN_CALIBRATION_SAMPLE) {
      underSampled += 1;
      buckets.push({
        block, cue, state, n,
        meanPredicted: null, realizedRate: null, delta: null, brier: null,
        advisoryConfidence: null,
      });
      continue;
    }

    const delta = realizedRate - meanPredicted;
    buckets.push({
      block, cue, state, n,
      meanPredicted: r3(meanPredicted),
      realizedRate: r3(realizedRate),
      delta: r3(delta),
      brier: r3(brier),
      // Only suggest a move once the gap is bigger than sampling noise on a
      // bucket this size. Below that, leave the vocab alone.
      advisoryConfidence: Math.abs(delta) >= 0.15 ? r3(realizedRate) : null,
    });
  }

  // Most-observed first: the buckets worth acting on are the ones with evidence.
  buckets.sort((a, b) => b.n - a.n || a.cue.localeCompare(b.cue));

  const top1n = observations.length;
  const agreed = observations.filter((o) => o.correct).length;
  const rate = agreed / top1n;

  const actionable = buckets.filter((b) => b.advisoryConfidence !== null);
  const note = actionable.length > 0
    ? `${actionable.length} cue${actionable.length !== 1 ? 's' : ''} `
      + `${actionable.length !== 1 ? 'disagree' : 'disagrees'} with the vocab by 0.15 or more. `
      + 'Recalibration is advisory — edit server/ontology/beetree-vocab.yaml by hand.'
    : 'No cue is off by more than 0.15. Vocab confidences are tracking the hives.';

  return {
    corrections,
    observations: observations.length,
    top1: { n: top1n, agreed, rate: r3(rate) },
    brier: r3(mean(observations.map((o) => (o.predicted - (o.correct ? 1 : 0)) ** 2))),
    buckets,
    underSampled,
    minSample: MIN_CALIBRATION_SAMPLE,
    note,
  };
}

/** Calibration for one vocab rule, or null when it has never fired. */
export function calibrationFor(block: string, cue: string, state: string): CalibrationBucket | null {
  const report = calibrationReport();
  return report.buckets.find(
    (b) => b.block === block && b.cue === cue && b.state === state,
  ) ?? null;
}
