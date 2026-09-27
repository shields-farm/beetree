// server/__tests__/calibration.test.ts
//
// Closing the capture loop: the model's candidate vs. what the beekeeper said.
//
// The properties that matter here, in the same spirit as inference.test.ts:
//
//   1. A cue must never be reported with a rate it has not earned. One
//      observation is an anecdote, and "100% accurate" off a single capture is
//      the overclaim the whole ontology is built to avoid.
//   2. Absence of evidence must read as absence, not as failure. A cue with no
//      data reports n = 0 and a null rate — never 0%.
//   3. The advisory must stay advisory. This module reads the vocab's confidence
//      and reports the gap; it must not mutate a single row of the graph or the
//      vocab file.
//
// Every test writes its own evidence rows into the per-worker throwaway DB that
// setup-test-db.ts points BEETREE_DB at, so nothing here can touch live data.

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { recordEvidence } from '../ontology.js';
import {
  calibrationReport,
  calibrationFor,
  MIN_CALIBRATION_SAMPLE,
} from '../calibration.js';

/** One ranked candidate, shaped as capture.ts serializes it into evidence. */
function ranked(over: Partial<{ state: string; cue: string; block: string; confidence: number }> = {}) {
  return {
    state: 'SwarmPrep',
    cue: 'swarm_cells',
    block: 'queen_inference',
    confidence: 0.85,
    ...over,
  };
}

/**
 * Write a correction row exactly as correctCapture does: the beekeeper's verdict
 * plus the model's ranked candidates preserved alongside it.
 */
function correction(opts: {
  captureId: string;
  humanState: string;
  candidates: ReturnType<typeof ranked>[];
  hiveId?: string | null;
  at?: string;
}) {
  const at = opts.at ?? new Date().toISOString();
  recordEvidence({
    evidence_kind: 'beekeeper_correction',
    content: {
      capture_id: opts.captureId,
      hive_id: opts.hiveId ?? 'hive-1',
      captured_at: at,
      correction: {
        state: opts.humanState,
        note: null,
        corrected_at: at,
        ai_ranked: opts.candidates,
        ai_top: opts.candidates[0]?.state ?? null,
        agreed: opts.candidates[0]?.state === opts.humanState,
      },
    },
    recorded_at: at,
  });
}

beforeEach(() => {
  // Corrections are the only input to calibration, so clearing them resets state.
  db.prepare(`DELETE FROM onto_evidence WHERE evidence_kind = 'beekeeper_correction'`).run();
});

describe('calibrationReport with no data', () => {
  it('reports absence rather than a zero rate', () => {
    const r = calibrationReport();
    expect(r.observations).toBe(0);
    expect(r.corrections).toBe(0);
    expect(r.top1).toBeNull();
    expect(r.brier).toBeNull();
    expect(r.buckets).toEqual([]);
    // The point: no data must not be dressed up as 0% success.
    expect(r.note).toContain('No labelled captures yet');
  });
});

describe('under-sampled buckets', () => {
  it('withholds the rate below the minimum sample and reports the count', () => {
    // MIN_CALIBRATION_SAMPLE - 1 observations of one cue, all confirmed.
    for (let i = 0; i < MIN_CALIBRATION_SAMPLE - 1; i++) {
      correction({
        captureId: `cap-under-${i}`,
        humanState: 'SwarmPrep',
        candidates: [ranked({ state: 'SwarmPrep', confidence: 0.85 })],
      });
    }

    const r = calibrationReport();
    expect(r.observations).toBe(MIN_CALIBRATION_SAMPLE - 1);
    expect(r.underSampled).toBe(1);

    const b = r.buckets[0];
    expect(b.n).toBe(MIN_CALIBRATION_SAMPLE - 1);
    // Every rate is withheld — this is the overclaim guard.
    expect(b.realizedRate).toBeNull();
    expect(b.meanPredicted).toBeNull();
    expect(b.brier).toBeNull();
    expect(b.advisoryConfidence).toBeNull();
  });

  it('publishes a rate once the sample clears the minimum', () => {
    for (let i = 0; i < MIN_CALIBRATION_SAMPLE; i++) {
      correction({
        captureId: `cap-at-${i}`,
        humanState: 'SwarmPrep',
        candidates: [ranked({ state: 'SwarmPrep', confidence: 0.85 })],
      });
    }
    const r = calibrationReport();
    expect(r.underSampled).toBe(0);
    const b = r.buckets[0];
    expect(b.n).toBe(MIN_CALIBRATION_SAMPLE);
    expect(b.realizedRate).toBe(1);
    expect(b.meanPredicted).toBeCloseTo(0.85, 3);
  });
});

describe('scoring', () => {
  it('computes realized rate, delta, and Brier from the predictions', () => {
    // 6 observations of swarm_cells at 0.85; the beekeeper confirms 3.
    for (let i = 0; i < 6; i++) {
      correction({
        captureId: `cap-swarm-${i}`,
        humanState: i < 3 ? 'SwarmPrep' : 'Queenright',
        candidates: [ranked({ state: 'SwarmPrep', cue: 'swarm_cells', confidence: 0.85 })],
      });
    }

    const b = calibrationFor('queen_inference', 'swarm_cells', 'SwarmPrep');
    expect(b).not.toBeNull();
    expect(b!.n).toBe(6);
    expect(b!.realizedRate).toBe(0.5);
    expect(b!.meanPredicted).toBeCloseTo(0.85, 3);
    // The cue claims 0.85 and lands 0.50 — it over-claims by 0.35.
    expect(b!.delta).toBeCloseTo(-0.35, 3);
    // Brier: 3 hits at 0.0225 + 3 misses at 0.7225, mean 0.3725. Reported
    // rounded to 3dp, so compare at 2dp rather than fight the rounding.
    expect(b!.brier).toBeCloseTo(0.3725, 2);
    // Worse than always guessing 0.5, and the gap is past the threshold, so a
    // replacement is suggested — at the realized rate, not the claimed one.
    expect(b!.advisoryConfidence).toBeCloseTo(0.5, 3);
  });

  it('leaves the vocab alone when the gap is within noise', () => {
    // 10 observations at 0.85 where 8 come true: delta = -0.05.
    for (let i = 0; i < 10; i++) {
      correction({
        captureId: `cap-close-${i}`,
        humanState: i < 8 ? 'SwarmPrep' : 'Queenright',
        candidates: [ranked({ state: 'SwarmPrep', confidence: 0.85 })],
      });
    }
    const b = calibrationFor('queen_inference', 'swarm_cells', 'SwarmPrep');
    expect(b!.n).toBe(10);
    expect(b!.delta).toBeCloseTo(-0.05, 3);
    // Well calibrated — no advisory. This is the guard against churning the
    // vocab on noise.
    expect(b!.advisoryConfidence).toBeNull();
  });

  it('reports a cue that under-claims as a positive delta', () => {
    // Claims 0.20, actually lands 1.0.
    for (let i = 0; i < 5; i++) {
      correction({
        captureId: `cap-under2-${i}`,
        humanState: 'Queenless',
        candidates: [ranked({ state: 'Queenless', cue: 'queen_not_found_no_eggs', block: 'queen_inference', confidence: 0.20 })],
      });
    }
    const b = calibrationFor('queen_inference', 'queen_not_found_no_eggs', 'Queenless');
    expect(b!.delta).toBeCloseTo(0.8, 3);
    expect(b!.advisoryConfidence).toBeCloseTo(1, 3);
  });

  it('scores every candidate, not just the top one', () => {
    // The model leads with SwarmPrep but also ranks Dwindling third. Both are
    // observations; only scoring the top would let a rare cue never accumulate.
    correction({
      captureId: 'cap-multi',
      humanState: 'Dwindling',
      candidates: [
        ranked({ state: 'SwarmPrep', cue: 'swarm_cells', confidence: 0.85 }),
        ranked({ state: 'Queenless', cue: 'queen_not_found_no_eggs', confidence: 0.40 }),
        ranked({ state: 'Dwindling', cue: 'spotty_mixed', block: 'brood_inference', confidence: 0.15 }),
      ],
    });

    const r = calibrationReport();
    expect(r.observations).toBe(3);
    expect(r.buckets.map((b) => b.state).sort()).toEqual(['Dwindling', 'Queenless', 'SwarmPrep']);
    // Top-1 accuracy is a separate, honest number: the lead candidate was wrong.
    expect(r.top1).toEqual({ n: 3, agreed: 1, rate: 0.333 });
  });
});

describe('bad input', () => {
  it('skips a malformed payload instead of guessing', () => {
    recordEvidence({
      evidence_kind: 'beekeeper_correction',
      content: 'not-json' as unknown as Record<string, unknown>,
      recorded_at: new Date().toISOString(),
    });
    const r = calibrationReport();
    expect(r.observations).toBe(0);
    expect(r.buckets).toEqual([]);
  });

  it('skips candidates with no usable confidence', () => {
    correction({
      captureId: 'cap-noconf',
      humanState: 'SwarmPrep',
      // A candidate missing confidence cannot be scored — drop it, do not treat
      // it as 0.
      candidates: [{ state: 'SwarmPrep', cue: 'swarm_cells', block: 'queen_inference' } as any],
    });
    const r = calibrationReport();
    expect(r.observations).toBe(0);
  });

  it('ignores a correction with no beekeeper state', () => {
    recordEvidence({
      evidence_kind: 'beekeeper_correction',
      content: { capture_id: 'x', correction: { ai_ranked: [ranked()] } },
      recorded_at: new Date().toISOString(),
    });
    expect(calibrationReport().observations).toBe(0);
  });
});

describe('advisory only', () => {
  it('does not modify the ontology graph', () => {
    for (let i = 0; i < 6; i++) {
      correction({
        captureId: `cap-pure-${i}`,
        humanState: 'Queenright', // every prediction wrong
        candidates: [ranked({ state: 'SwarmPrep', confidence: 0.9 })],
      });
    }

    const before = {
      entity: db.prepare(`SELECT COUNT(*) c FROM onto_entity WHERE superseded_by IS NULL`).get() as any,
      relation: db.prepare(`SELECT COUNT(*) c FROM onto_relation WHERE superseded_by IS NULL`).get() as any,
      instantiation: db.prepare(`SELECT COUNT(*) c FROM onto_instantiation WHERE superseded_by IS NULL`).get() as any,
    };

    const r = calibrationReport();
    // A large, confidently-wrong bucket — exactly what would tempt an auto-write.
    expect(r.buckets[0].advisoryConfidence).not.toBeNull();

    const after = {
      entity: db.prepare(`SELECT COUNT(*) c FROM onto_entity WHERE superseded_by IS NULL`).get() as any,
      relation: db.prepare(`SELECT COUNT(*) c FROM onto_relation WHERE superseded_by IS NULL`).get() as any,
      instantiation: db.prepare(`SELECT COUNT(*) c FROM onto_instantiation WHERE superseded_by IS NULL`).get() as any,
    };

    // Reading calibration must never write. The vocab is Mark's to edit.
    expect(after).toEqual(before);
  });
});
