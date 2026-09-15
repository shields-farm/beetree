// server/__tests__/capture.test.ts
//
// Capture-loop logic that does not need the server or a model: hive resolution
// from a spoken transcript, and speech composition from an inference result.
//
// Hive attribution is the highest-consequence decision in the pipeline — a frame
// filed against the wrong hive silently corrupts the ontology and the eventual
// training set, and nothing downstream can detect it. So the resolver is
// deliberately conservative: it refuses when it cannot be sure.

import { describe, it, expect } from 'vitest';
import { resolveHive, composeSpeech } from '../capture.js';
import { inferFromFrame, outstandingChecks } from '../inference.js';
import type { FrameAnalysis } from '../vision.js';

const HIVES = [
  { id: 'hive-1', name: 'Hive Alpha', apiaryId: 'apiary-1' },
  { id: 'hive-2', name: 'Hive Bravo', apiaryId: 'apiary-1' },
  { id: 'hive-5', name: 'Langstroth Echo', apiaryId: 'apiary-3' },
];

function frame(over: Partial<FrameAnalysis> = {}): FrameAnalysis {
  return {
    broodPattern: 'solid', queenSpotted: false, queenLocation: 'not visible',
    queenCellsVisible: false, broodRatio: 0.5, honeyRatio: 0.2, pollenRatio: 0.1,
    cappedBroodPresent: true, eggsVisible: false, larvaeVisible: false,
    diseases: [], pests: [], overallAssessment: '', recommendations: [], concerns: [],
    ...over,
  };
}

describe('resolveHive', () => {
  it('prefers an explicit hive id', () => {
    const r = resolveHive('hive-2', 'checking Alpha', HIVES);
    expect(r.hive?.id).toBe('hive-2');
    expect(r.by).toBe('explicit');
  });

  it('resolves a hive named in the transcript', () => {
    const r = resolveHive(undefined, 'BeeTree, checking Hive Alpha, brood looks spotty', HIVES);
    expect(r.hive?.id).toBe('hive-1');
    expect(r.by).toBe('transcript');
  });

  it('matches the distinguishing token when "hive" is dropped', () => {
    const r = resolveHive(undefined, 'this is bravo, looks fine', HIVES);
    expect(r.hive?.id).toBe('hive-2');
  });

  it('prefers the longer name when one name contains another', () => {
    const hives = [
      { id: 'h1', name: 'Hive Alpha', apiaryId: 'a' },
      { id: 'h2', name: 'Hive Alpha Two', apiaryId: 'a' },
    ];
    const r = resolveHive(undefined, 'at hive alpha two now', hives);
    expect(r.hive?.id).toBe('h2');
  });

  it('refuses to guess on a multi-hive yard with no identifying speech', () => {
    const r = resolveHive(undefined, 'brood looks spotty', HIVES);
    expect(r.hive).toBeNull();
    expect(r.by).toBe('unresolved');
  });

  it('attributes freely when the yard has exactly one hive', () => {
    const r = resolveHive(undefined, 'brood looks spotty', [HIVES[0]]);
    expect(r.hive?.id).toBe('hive-1');
    expect(r.by).toBe('single-hive');
  });

  it('returns unresolved rather than throwing on a blank transcript', () => {
    expect(resolveHive(undefined, '', HIVES).by).toBe('unresolved');
    expect(resolveHive(undefined, undefined, HIVES).by).toBe('unresolved');
    expect(resolveHive('does-not-exist', undefined, HIVES).by).toBe('unresolved');
  });
});

describe('composeSpeech', () => {
  it('speaks the conclusion and the first check when a state is supported', () => {
    const analysis = frame({ broodPattern: 'solid', cappedBroodPresent: true });
    const inference = inferFromFrame(analysis);
    const speech = composeSpeech({
      hiveName: 'Hive Alpha', analysis, inference, checks: outstandingChecks(inference),
    });
    expect(speech).toContain('Hive Alpha');
    expect(speech).toContain('queenright');
    // Two sentences, hard stop.
    expect(speech.split(/(?<=[.!?])\s+/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it('states the ambiguity out loud instead of picking a winner', () => {
    const analysis = frame({ broodPattern: 'spotty', cappedBroodPresent: true });
    const inference = inferFromFrame(analysis);
    const speech = composeSpeech({
      hiveName: 'Hive Bravo', analysis, inference, checks: outstandingChecks(inference),
    });
    expect(speech.toLowerCase()).toContain('too close to call');
    // Names the runner-up so the beekeeper knows what else to look for.
    expect(speech.toLowerCase()).toMatch(/could also be/);
    expect(speech).toMatch(/percent/);
  });

  it('asks for a retry rather than diagnosing an unreadable frame', () => {
    const analysis = frame({ broodPattern: 'unknown', cappedBroodPresent: false });
    const inference = inferFromFrame(analysis);
    const speech = composeSpeech({
      hiveName: 'Hive Alpha', analysis, inference, checks: outstandingChecks(inference),
    });
    expect(speech.toLowerCase()).toContain("couldn't read");
    expect(speech.toLowerCase()).not.toContain('queenless');
  });

  it('stays inside a speakable length even with long vocab notes', () => {
    const analysis = frame({ broodPattern: 'spotty', cappedBroodPresent: true });
    const inference = inferFromFrame(analysis);
    const speech = composeSpeech({
      hiveName: 'Hive Alpha', analysis, inference, checks: outstandingChecks(inference),
    });
    expect(speech.length).toBeLessThanOrEqual(320);
  });
});
