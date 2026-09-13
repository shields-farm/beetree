// server/seed-threat-entities.ts — materialize ThreatSpecies entities into the
// ontology graph from the vocab catalog.
//
// Why: the catalog (onto_threat_species) is seeded on boot from beetree-vocab.yaml,
// but the *graph* layer (onto_entity) is not — so the World tab threat catalog and
// every graph traversal silently drop species that have no entity row. As of
// 2026-09-12 only 19 of 33 species had entity rows.
//
// Idempotent: creates only what is missing. Relations are asserted with the same
// predicate vocabulary the agent uses (vectorOf / vectoredBy is stored as
// vectorOf from the vector's side; afb/efb get an `indicates` edge to BroodPattern
// only if a BroodPattern entity exists).
//
// Run:  cd ~/beetree/server && npx tsx seed-threat-entities.ts
import { db } from './db.js';
import { upsertEntity, getEntity, addRelation, loadVocab } from './ontology.js';

const vocab = loadVocab();
let created = 0, existed = 0, rels = 0, skippedRels: string[] = [];

for (const s of vocab.threat_species) {
  const entityId = `threat-${s.id}`;
  if (getEntity(entityId)) {
    existed++;
  } else {
    upsertEntity({
      entity_id: entityId,
      entity_type: 'ThreatSpecies',
      name: s.name,
      properties: {
        species_id: s.id,
        scientific: s.scientific ?? null,
        kind: s.kind,
        notifiable: Boolean((s as any).notifiable),
      },
      source_table: 'onto_threat_species',
      source_id: s.id,
    });
    created++;
  }
}

// Vector relations: varroa_destructor -> dwv/bqcv/sbv/abpv (vocab `vectors`),
// and the virus side (vocab `vectored_by`). Both stored as `vectorOf` from the
// vector's side — the vocab declares the inverse name, but relations are stored
// one-directionally.
function link(vectorId: string, targetId: string, why: string) {
  if (!getEntity(`threat-${vectorId}`) || !getEntity(`threat-${targetId}`)) {
    skippedRels.push(`${why}: missing entity (threat-${vectorId} or threat-${targetId})`);
    return;
  }
  const r = addRelation(`threat-${vectorId}`, 'vectorOf', `threat-${targetId}`, []);
  if (r.ok) rels++;
  else skippedRels.push(`${why}: ${r.reason}`);
}

for (const s of vocab.threat_species) {
  for (const target of (s as any).vectors ?? []) link(s.id, target, `vectors of ${s.id}`);
  for (const vector of (s as any).vectored_by ?? []) link(vector, s.id, `vectored_by ${s.id}`);
}

// Notifiable disease -> diagnostic signal. Only if a BroodPattern node exists:
// never point an edge at a class name (that is the dangling-edge bug).
const broodPattern = getEntity('BroodPattern') ?? null;
if (broodPattern) {
  for (const id of ['afb', 'efb', 'chalkbrood']) {
    if (getEntity(`threat-${id}`)) {
      const r = addRelation(`threat-${id}`, 'indicates', 'BroodPattern', []);
      if (r.ok) rels++;
    }
  }
} else {
  skippedRels.push('afb/efb/chalkbrood -> indicates BroodPattern: no BroodPattern entity exists (edge would dangle on a class name)');
}

console.log(`[seed-threats] entities: ${created} created, ${existed} existed (catalog ${vocab.threat_species.length})`);
console.log(`[seed-threats] relations asserted: ${rels}`);
if (skippedRels.length) {
  console.log('[seed-threats] skipped:');
  for (const s of skippedRels) console.log('  - ' + s);
}

const total = db.prepare(
  `SELECT COUNT(*) AS n FROM onto_entity WHERE superseded_by IS NULL AND entity_type = 'ThreatSpecies'`
).get() as any;
console.log(`[seed-threats] ThreatSpecies entity rows now: ${total.n}/${vocab.threat_species.length}`);
