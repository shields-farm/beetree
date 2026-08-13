// server/backfill-ontology.ts — one-shot: materialize the yard's existing
// data (apiaries, hives, sensors, occupancy) into the ontology graph.
//
// Idempotent: safe to rerun (upserts only; skips if entities already exist).
// Runs the same code path Buzz's ontology tools use, so the graph Buzz sees
// matches what the World tab renders.
//
// Run:  cd ~/beetree/server && npx tsx backfill-ontology.ts
import { db } from './db.js';
import {
  upsertEntity,
  addRelation,
  recordInstantiation,
  currentState,
  getEntity,
} from './ontology.js';

function log(msg: string) { console.log(`[backfill] ${msg}`); }

// ─── Read current yard state ────────────────────────────────────────────────
const apiaries = db.prepare(
  `SELECT id, entity_id, name, address FROM apiaries WHERE superseded_by IS NULL`
).all() as any[];

const hives = db.prepare(
  `SELECT id, entity_id, apiaryId, name, healthStatus, notes FROM hives WHERE superseded_by IS NULL`
).all() as any[];

const sensors = db.prepare(
  `SELECT id, entity_id, name, model, hiveId FROM sensors WHERE superseded_by IS NULL`
).all() as any[];

// Resolve whatever hiveId/apiaryId actually contains — in this DB they hold
// entity slugs (hive-1, apiary-1) OR row PKs. Map BOTH to ontology entity_id.
const hiveToEntity = new Map<string, string>();
for (const h of hives) {
  hiveToEntity.set(h.id, h.entity_id);
  hiveToEntity.set(h.entity_id, h.entity_id);
}
const apiaryToEntity = new Map<string, string>();
for (const a of apiaries) {
  apiaryToEntity.set(a.id, a.entity_id);
  apiaryToEntity.set(a.entity_id, a.entity_id);
}

let created = 0, relations = 0, skipped = 0;

// ─── 1. Apiaries → Branch ───────────────────────────────────────────────────
for (const a of apiaries) {
  const exists = getEntity(a.entity_id);
  if (exists) { skipped++; continue; }
  upsertEntity({
    entity_id: a.entity_id,
    entity_type: 'Branch',
    name: a.name,
    properties: { address: a.address ?? null },
    source_table: 'apiaries',
    source_id: a.id,
  });
  created++;
}
log(`branches: ${apiaries.length} seen, ${created} created so far, ${skipped} existed`);

// ─── 2. Hives → Hive + isOn(hive, branch) ─────────────────────────────────
let hCreated = 0, hExisted = 0, hRel = 0;
for (const h of hives) {
  const exists = getEntity(h.entity_id);
  if (!exists) {
    upsertEntity({
      entity_id: h.entity_id,
      entity_type: 'Hive',
      name: h.name,
      properties: { healthStatus: h.healthStatus, notes: h.notes ?? null },
      source_table: 'hives',
      source_id: h.id,
    });
    hCreated++;
  } else {
    hExisted++;
  }
  const apiaryEntity = apiaryToEntity.get(h.apiaryId);
  if (apiaryEntity) {
    const r = addRelation(h.entity_id, 'isOn', apiaryEntity, []);
    if (r.ok) hRel++; else log(`relation skip: ${r.reason}`);
  }
}
log(`hives: ${hCreated} created, ${hExisted} existed, ${hRel} isOn relations`);

// ─── 3. Sensors → Sensor + isOn(sensor, hive) ─────────────────────────────
let sCreated = 0, sExisted = 0, sRel = 0;
for (const s of sensors) {
  const exists = getEntity(s.entity_id);
  if (!exists) {
    upsertEntity({
      entity_id: s.entity_id,
      entity_type: 'Sensor',
      name: s.name,
      properties: { model: s.model },
      source_table: 'sensors',
      source_id: s.id,
    });
    sCreated++;
  } else {
    sExisted++;
  }
  const hiveEntity = s.hiveId ? hiveToEntity.get(s.hiveId) : null;
  if (hiveEntity) {
    const r = addRelation(s.entity_id, 'isOn', hiveEntity, []);
    if (r.ok) sRel++; else log(`relation skip: ${r.reason}`);
  }
}
log(`sensors: ${sCreated} created, ${sExisted} existed, ${sRel} isOn relations`);

// ─── 4. Colony per occupied hive + Queenright bootstrap state ─────────────
// A hive with a sensor is "occupied" (has a colony in it). We assert a
// Colony entity and a Queenright state as a starting hypothesis the agent
// can refine as inspection and sensor data come in.
let cCreated = 0, cExisted = 0, qStates = 0;
const occupied = new Set(sensors.map(s => s.hiveId).filter(Boolean) as string[]);
for (const h of hives) {
  // Match on both PK and entity slug, same resolution rule as above.
  if (!occupied.has(h.id) && !occupied.has(h.entity_id)) continue;
  const colonyId = `onto_colony_${h.id}`;
  const exists = getEntity(colonyId);
  if (!exists) {
    upsertEntity({
      entity_id: colonyId,
      entity_type: 'Colony',
      name: `${h.name} colony`,
      properties: { occupancy: 'inferred-from-sensor' },
      source_table: 'hives',
      source_id: h.id,
    });
    cCreated++;
    addRelation(colonyId, 'isOn', h.entity_id, []);
  } else {
    cExisted++;
  }
  // Queenright bootstrap state — confidence 0.5 (hypothesis, not observation)
  const existing = currentState(colonyId).filter(s => s.state_class === 'Queenright');
  if (existing.length === 0) {
    recordInstantiation({
      state_class: 'Queenright',
      subject_id: colonyId,
      confidence: 0.5,
      supporting_evidence: [],
      rationale: 'Bootstrap: colony inferred from attached sensor; unverified by inspection.',
    });
    qStates++;
  }
}
log(`colonies: ${cCreated} created, ${cExisted} existed, ${qStates} Queenright bootstraps`);

// ─── Summary ────────────────────────────────────────────────────────────────
const counts = db.prepare(
  `SELECT entity_type, COUNT(*) as n FROM onto_entity WHERE superseded_by IS NULL GROUP BY entity_type ORDER BY n DESC`
).all() as any[];
const relCount = db.prepare(
  `SELECT COUNT(*) as n FROM onto_relation WHERE superseded_by IS NULL`
).get() as any;
const stateCount = db.prepare(
  `SELECT COUNT(*) as n FROM onto_instantiation WHERE superseded_by IS NULL AND valid_to IS NULL`
).get() as any;

console.log('\n[backfill] final graph:');
for (const r of counts) console.log(`  ${r.entity_type}: ${r.n}`);
console.log(`  relations: ${relCount.n}`);
console.log(`  active states: ${stateCount.n}`);
