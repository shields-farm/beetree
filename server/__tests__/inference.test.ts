// server/__tests__/inference.test.ts
//
// The join between a vision FrameAnalysis and the ontology's differential rules.
// These tests pin the two properties that matter:
//
//   1. a weak observation must NOT come out as a confident diagnosis, and
//   2. the differential checklists the vocab demands must always travel with
//      the candidate that needs them.
//
// Both are the difference between an assistant and a liability: the vocab's own
// `spotty_mixed` note says "do NOT jump to a conclusion", and a system that
// reports "queenless" off one photo is exactly the overclaim Jamie pushes back on.

import { describe, it, expect } from 'vitest';
import { inferFromFrame, outstandingChecks, MIN_SUPPORTED } from '../inference.js';
import type { FrameAnalysis } from '../vision.js';

function frame(over: Partial<FrameAnalysis> = {}): FrameAnalysis {
  return {
    broodPattern: 'solid',
    queenSpotted: false,
    queenLocation: 'not visible',
    queenCellsVisible: false,
    broodRatio: 0.5,
    honeyRatio: 0.2,
    pollenRatio: 0.1,
    cappedBroodPresent: true,
    eggsVisible: false,
    larvaeVisible: false,
    diseases: [],
    pests: [],
    overallAssessment: '',
    recommendations: [],
    concerns: [],
    ...over,
  };
}

describe('inferFromFrame', () => {
  it('treats a clean solid capped brood frame as queenright, and says so', () => {
    const r = inferFromFrame(frame({ broodPattern: 'solid', cappedBroodPresent: true }));
    expect(r.matchedCues).toContain('solid_capped');
    const queenright = r.ranked.find((c) => c.state === 'Queenright');
    expect(queenright).toBeDefined();
    // 0.90 vocab x 0.90 evidence weight.
    expect(queenright!.confidence).toBeCloseTo(0.81, 2);
    expect(r.supported.map((c) => c.state)).toContain('Queenright');
    expect(r.lowConfidence).toBe(false);
  });

  it('never returns spotty brood as a confident diagnosis', () => {
    const r = inferFromFrame(frame({
      broodPattern: 'spotty',
      cappedBroodPresent: true,
      eggsVisible: false,
      larvaeVisible: false,
    }));
    expect(r.matchedCues).toContain('spotty_mixed');
    // Vocab tops out at Queenright 0.25; weighting can only push it down.
    expect(r.ranked.every((c) => c.confidence < MIN_SUPPORTED)).toBe(true);
    expect(r.lowConfidence).toBe(true);
    expect(r.supported).toEqual([]);
    // The honest read is "too close to call", not a state name on its own.
    expect(r.lead).not.toBeNull();
    expect(r.lead!.confidence).toBeLessThan(0.25);
  });

  it('carries the five differential checks the vocab requires for spotty brood', () => {
    const r = inferFromFrame(frame({ broodPattern: 'spotty', cappedBroodPresent: true }));
    const checks = outstandingChecks(r);
    expect(checks.join(' ')).toMatch(/Varroa: alcohol wash or sugar shake/);
    expect(checks.join(' ')).toMatch(/Queen: look for eggs/);
    expect(checks.join(' ')).toMatch(/Disease: smell/);
    expect(checks.join(' ')).toMatch(/Pesticide: ask about recent spraying/);
    expect(checks.join(' ')).toMatch(/Cold snap/);
  });

  it('does not claim eggs were seen just because brood is capped', () => {
    // Capped brood means she was laying 9-20 days ago, not that eggs are present
    // now. Treating it as an eggs-present observation inflates Queenright from
    // 0.20 to 0.80 off something we never saw, so it must not happen.
    const r = inferFromFrame(frame({
      broodPattern: 'spotty',
      cappedBroodPresent: true,
      eggsVisible: false,
      larvaeVisible: false,
      queenSpotted: false,
    }));
    expect(r.matchedCues).not.toContain('queen_not_found_eggs_present');
    expect(r.matchedCues).toContain('queen_not_found_no_eggs');
    // Queenright must arrive from the wide-open brood cue (0.25), never from the
    // eggs-present cue (0.80) that we had no right to claim.
    const queenright = r.ranked.find((c) => c.state === 'Queenright');
    expect(queenright!.cue).not.toBe('queen_not_found_eggs_present');
    expect(queenright!.vocabConfidence).toBeLessThan(0.5);
  });

  it('takes the eggs-present branch only on actual open brood', () => {
    const r = inferFromFrame(frame({
      broodPattern: 'solid',
      cappedBroodPresent: true,
      larvaeVisible: true,
    }));
    expect(r.matchedCues).toContain('queen_not_found_eggs_present');
  });

  it('discounts a negative egg finding far below a positive queen sighting', () => {
    const negative = inferFromFrame(frame({
      broodPattern: 'spotty', cappedBroodPresent: true,
      eggsVisible: false, larvaeVisible: false, queenSpotted: false,
    })).ranked.find((c) => c.state === 'Queenright')!;

    const positive = inferFromFrame(frame({
      broodPattern: 'solid', cappedBroodPresent: true,
      queenSpotted: true, queenLocation: 'center of the frame',
    })).ranked.find((c) => c.state === 'Queenright')!;

    // "I could not see eggs" is not evidence of anything like "I saw the queen".
    expect(negative.confidence).toBeLessThan(positive.confidence / 3);
  });

  it('takes the drone-dominant branch only when the model actually says drone', () => {
    const mixed = inferFromFrame(frame({ broodPattern: 'spotty', cappedBroodPresent: true }));
    expect(mixed.matchedCues).toContain('spotty_mixed');
    expect(mixed.matchedCues).not.toContain('spotty_drone_dominant');

    const drone = inferFromFrame(frame({
      broodPattern: 'spotty',
      cappedBroodPresent: true,
      overallAssessment: 'Bullet-shaped drone cappings raised above the surface.',
    }));
    expect(drone.matchedCues).toContain('spotty_drone_dominant');
    // DroneLayer 0.85 x 0.80 = 0.68, over the bar.
    const dl = drone.ranked.find((c) => c.state === 'DroneLayer');
    expect(dl).toBeDefined();
    expect(dl!.confidence).toBeGreaterThan(MIN_SUPPORTED);
    expect(drone.supported.map((c) => c.state)).toContain('DroneLayer');
  });

  it('routes DWV to the varroa block rather than treating it as its own state', () => {
    const r = inferFromFrame(frame({
      broodPattern: 'patchy',
      diseases: [{ type: 'Deformed wing virus (DWV)', confidence: 'high', note: 'crumpled wings' }],
    }));
    expect(r.matchedCues).toContain('deformed_wings');
    const dwindling = r.ranked.find((c) => c.state === 'Dwindling');
    expect(dwindling).toBeDefined();
    // Requires a mite wash before anything is concluded.
    expect(dwindling!.checks.join(' ')).toMatch(/alcohol wash or sugar shake/);
  });

  it('escalates to parasitic mite syndrome when DWV and visible mites coincide', () => {
    const r = inferFromFrame(frame({
      broodPattern: 'patchy',
      diseases: [{ type: 'deformed wing virus', confidence: 'high', note: '' }],
      pests: [{ type: 'Varroa mites', count: 3, note: 'on bee bodies' }],
    }));
    expect(r.matchedCues).toContain('parasitic_mite_syndrome');
    expect(r.ranked[0].state).toBe('Dwindling');
  });

  it('reads queen cells by position: bottom edge is swarm prep, frame face is supersedure', () => {
    const swarm = inferFromFrame(frame({ queenCellsVisible: true, queenLocation: 'bottom edge of frame' }));
    expect(swarm.matchedCues).toContain('swarm_cells');
    expect(swarm.ranked.find((c) => c.state === 'SwarmPrep')).toBeDefined();

    const super_ = inferFromFrame(frame({ queenCellsVisible: true, queenLocation: 'face of the frame, center' }));
    expect(super_.matchedCues).toContain('supersedure_cells');
  });

  it('reports no candidates when the frame is unreadable rather than inventing one', () => {
    const r = inferFromFrame(frame({
      broodPattern: 'unknown',
      cappedBroodPresent: false,
      eggsVisible: false,
      larvaeVisible: false,
      queenSpotted: false,
    }));
    expect(r.ranked).toEqual([]);
    expect(r.lead).toBeNull();
    expect(r.lowConfidence).toBe(true);
  });

  it('always sets a weighted confidence at or below the vocab confidence', () => {
    const cases: FrameAnalysis[] = [
      frame({ broodPattern: 'solid', cappedBroodPresent: true }),
      frame({ broodPattern: 'spotty', cappedBroodPresent: true }),
      frame({ broodPattern: 'none' }),
      frame({ broodPattern: 'patchy', cappedBroodPresent: true }),
      frame({ broodPattern: 'solid', queenSpotted: true, queenLocation: 'center, marked with a blue dot' }),
    ];
    for (const f of cases) {
      for (const c of inferFromFrame(f).candidates) {
        expect(c.confidence).toBeLessThanOrEqual(c.vocabConfidence);
        expect(c.confidence).toBeGreaterThanOrEqual(0);
        expect(c.evidenceWeight).toBeGreaterThan(0);
        expect(c.evidenceWeight).toBeLessThanOrEqual(1);
      }
    }
  });
});
