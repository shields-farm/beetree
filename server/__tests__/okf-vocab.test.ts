// The OKF bundle replaced server/ontology/beetree-vocab.yaml as the canonical
// vocabulary. These assertions are the regression guard the YAML used to get for
// free by being one file a human read: the bundle must stay conformant, must
// resolve every internal link, and must still produce the diagnostic rules the
// inference engine depends on.
import { describe, expect, it } from 'vitest';
import { readBundle, outgoing, sections } from '../okf.js';
import { buildVocab, loadVocab, VOCAB_DIR } from '../okf-vocab.js';

const concepts = readBundle(VOCAB_DIR);
const byType = (t: string) => concepts.filter((c) => c.frontmatter.type === t);

describe('OKF bundle conformance', () => {
  it('every concept carries a type and readBundle returns the whole set', () => {
    expect(concepts.length).toBeGreaterThan(100);
    for (const c of concepts) expect(c.frontmatter.type).toBeTruthy();
  });

  it('resolves every internal link', () => {
    const ids = new Set(concepts.map((c) => c.id));
    const broken: string[] = [];
    for (const c of concepts) {
      for (const t of outgoing(c)) {
        if (!ids.has(t) && !t.endsWith('/index')) broken.push(`${c.id} -> ${t}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('has the expected concept counts', () => {
    // 18 modelled classes + Site and Inspection, which the vocabulary references
    // (via `extends` and `observed_via`) but never defines — carried as drafts.
    expect(byType('Ontology Class')).toHaveLength(20);
    expect(byType('Ontology Relation')).toHaveLength(10);
    expect(byType('Inference Rule')).toHaveLength(47);
    expect(byType('Threat Species')).toHaveLength(33);
    expect(byType('Colony State')).toHaveLength(8);
    expect(byType('Season Window')).toHaveLength(4);
  });

  it('marks the referenced-but-undefined classes as draft', () => {
    const drafts = concepts.filter((c) => c.frontmatter.type === 'Ontology Class' && c.frontmatter.status === 'draft');
    expect(drafts.map((d) => d.frontmatter.key).sort()).toEqual(['Inspection', 'Site']);
  });
});

describe('vocabulary rebuilt from the bundle', () => {
  const vocab = loadVocab();

  it('carries the bundle identity', () => {
    expect(vocab.name).toBe('beetree-vocab');
    expect(vocab.version).toBe('1.1.0');
    expect(vocab.schema_version).toBe('2026-08-11');
  });

  it('rebuilds the closed relation set', () => {
    expect(Object.keys(vocab.relations).sort()).toEqual(
      ['descendedFrom', 'detectedIn', 'emits', 'heads', 'indicates', 'isOn',
       'observedDuring', 'precedes', 'resolvedBy', 'vectorOf'].sort());
  });

  it('preserves the differential rule that must not be concluded from', () => {
    // spotty_mixed is the hard one: the notes say explicitly not to jump to a
    // conclusion. If this ever collapses to a single candidate, the inference
    // engine is silently over-claiming.
    const cue = vocab.brood_inference!.spotty_mixed;
    expect(cue.indicates).toEqual([
      { state: 'Queenright', confidence: 0.25, reason: 'failing queen' },
      { state: 'Queenless', confidence: 0.2, reason: 'queen died or failed' },
      { state: 'Dwindling', confidence: 0.15, reason: 'varroa/virus load suppressing brood' },
    ]);
    expect(cue.notes).toContain('Differential diagnosis');
  });

  it('keeps age_cycles: 0 on new comb (falsy, so easy to drop)', () => {
    expect(vocab.comb_inference!.white_new.age_cycles).toBe(0);
  });

  it('indexes aliases to the canonical species id', () => {
    expect(vocab.threat_aliases.varroa).toBe('varroa_destructor');
    expect(vocab.threat_aliases.kettlebeetle).toBe('shb');
    expect(Object.keys(vocab.threat_aliases)).toHaveLength(22);
  });

  it('carries the threat catalog with vectors', () => {
    const varroa = vocab.threat_species.find((s) => s.id === 'varroa_destructor')!;
    expect(varroa.kind).toBe('parasite');
    expect(varroa.vectors).toEqual(['dwv', 'bqcv', 'sbv', 'abpv']);
    const afb = vocab.threat_species.find((s) => s.id === 'afb')!;
    expect(afb.notifiable).toBe(true);
  });

  it('keeps the undefined-behavior contract', () => {
    expect(Object.keys(vocab.undefined_behavior).length).toBeGreaterThan(0);
    expect(vocab.undefined_behavior.species_miss).toContain('offers nearest defined species');
  });
});
