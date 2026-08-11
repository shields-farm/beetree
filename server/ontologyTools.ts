// server/ontologyTools.ts — ontology-specific tools registered onto Buzz.
// These give the agent direct, structured access to the world-model:
// threat-species lookup, entity graph, colony state history, and assertions.

import {
  lookupThreatSpecies, addRelation, getEntityGraph, currentState,
  recordEvent, recordInstantiation, getThreatSpecies, listThreatSpecies,
  getSeasonPhaseFor, getUndefinedBehavior,
} from './ontology.js';

export const ontologyToolSchemas = [
  {
    type: 'function' as const,
    function: {
      name: 'onto_lookup_pest',
      description: 'Look up a honey-bee pest/parasite/disease by common name, alias, scientific name, or id. Use *before* asserting facts about a pest — grounds names to the canonical catalog. Unknown names return a checkpoint message rather than guessing.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'e.g. "varroa", "small hive beetle", "kettle beetle", "AFB"' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_list_threats',
      description: 'List all defined honey-bee threats — use this as a sanity list when reasoning about what could be wrong with a hive. Filter by kind: pest, parasite, disease, or commensal.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['pest', 'parasite', 'disease', 'commensal'] } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_assert_relationship',
      description: 'Assert a structured relation between two known entities in the yard graph. Predicates from the defined ontology only (e.g. isOn, heads, vectorOf, descendedFrom). Use for new facts the agent has evidence for.',
      parameters: {
        type: 'object',
        properties: {
          subjectId:   { type: 'string' },
          predicate:   { type: 'string', description: 'One of: heads, isOn, emits, detectedIn, descendedFrom, precedes, vectorOf, resolvedBy' },
          objectId:    { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' }, description: 'onto_evidence entity_ids backing the assertion' },
        },
        required: ['subjectId', 'predicate', 'objectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_record_event',
      description: 'Record a typed occurrence in time on a Colony/Hive/Queen entity (SwarmEvent, Treatment, Detection, Supersedure, MatingFlight). Use this to persist ground truth.',
      parameters: {
        type: 'object',
        properties: {
          eventType:   { type: 'string', enum: ['SwarmEvent', 'Treatment', 'Detection', 'Supersedure', 'MatingFlight', 'Intervention'] },
          subjectId:   { type: 'string', description: 'onto_entity.entity_id (usually a Colony)' },
          occurredAt:  { type: 'string', description: 'ISO datetime; defaults to now' },
          properties:  { type: 'object', description: 'event-specific payload (e.g. { swarmLossKg: 2.1 })' },
          confidence:  { type: 'number' },
        },
        required: ['eventType', 'subjectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_record_state',
      description: 'Record an inferred colony state (Queenright, Queenless, SwarmPrep, Dwindling, Robbing, Starving) with evidence. Auto-supersedes any prior open state of the same class on the subject.',
      parameters: {
        type: 'object',
        properties: {
          stateClass:        { type: 'string', enum: ['Queenright', 'Queenless', 'SwarmPrep', 'Dwindling', 'Robbing', 'Starving'] },
          subjectId:         { type: 'string' },
          validFrom:         { type: 'string' },
          confidence:        { type: 'number' },
          rationale:         { type: 'string' },
          supportingEvidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['stateClass', 'subjectId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_get_graph',
      description: 'Fetch the subgraph around a yard entity: the entity itself, its direct edges, and neighbors. Use when you need the typed context of "this hive + its colony + its queen + its sensors".',
      parameters: {
        type: 'object',
        properties: { entityId: { type: 'string' }, depth: { type: 'number', description: 'currently only 1-hop graphs' } },
        required: ['entityId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_current_state',
      description: 'List the currently inferred states on a Colony or Hive (what the ontology believes *now*).',
      parameters: { type: 'object', properties: { subjectId: { type: 'string' } }, required: ['subjectId'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_lookup_species_detail',
      description: 'Get full catalog card for a pest species by its canonical species_id (e.g. "varroa_destructor"). Use after onto_lookup_pest when you need vectors, notes, notifiable flag, etc.',
      parameters: { type: 'object', properties: { speciesId: { type: 'string' } }, required: ['speciesId'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'onto_current_season',
      description: 'Get the current phenological season phase (Buildup, HoneyFlow, Dearth, WinterCluster) from the ontology — replaces hardcoded month heuristics in agent prompts.',
      parameters: { type: 'object', properties: { siteKey: { type: 'string', description: 'defaults to "default"' } } },
    },
  },
];

export async function dispatchOntologyTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case 'onto_lookup_pest': {
        const r = lookupThreatSpecies(String(args.name ?? ''));
        if (!r.found) {
          return JSON.stringify({ found: false, message: getUndefinedBehavior('species_miss') });
        }
        return JSON.stringify({ found: true, alias: r.alias, species: r.found });
      }
      case 'onto_list_threats': {
        return JSON.stringify({ threats: listThreatSpecies(args.kind) });
      }
      case 'onto_assert_relationship': {
        const r = addRelation(String(args.subjectId), String(args.predicate), String(args.objectId), args.evidenceIds ?? []);
        if (!r.ok) return JSON.stringify({ ok: false, reason: r.reason });
        return JSON.stringify({ ok: true, predicate: args.predicate });
      }
      case 'onto_record_event': {
        const entityId = recordEvent({
          event_type: String(args.eventType),
          subject_id: String(args.subjectId),
          occurred_at: args.occurredAt,
          properties: args.properties ?? {},
          confidence: args.confidence,
        });
        return JSON.stringify({ ok: true, entityId });
      }
      case 'onto_record_state': {
        const entityId = recordInstantiation({
          state_class: String(args.stateClass),
          subject_id: String(args.subjectId),
          valid_from: args.validFrom,
          confidence: args.confidence,
          supporting_evidence: args.supportingEvidence ?? [],
          rationale: args.rationale,
        });
        return JSON.stringify({ ok: true, entityId });
      }
      case 'onto_get_graph': {
        return JSON.stringify(getEntityGraph(String(args.entityId)));
      }
      case 'onto_current_state': {
        return JSON.stringify({ states: currentState(String(args.subjectId)) });
      }
      case 'onto_lookup_species_detail': {
        return JSON.stringify({ species: getThreatSpecies(String(args.speciesId)) });
      }
      case 'onto_current_season': {
        return JSON.stringify(getSeasonPhaseFor(new Date().toISOString(), args.siteKey ?? 'default'));
      }
      default:
        return JSON.stringify({ error: `Unknown ontology tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
