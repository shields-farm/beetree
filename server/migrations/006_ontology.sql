-- 006_ontology.sql — Beetree knowledge-graph layer (ontology persistence)
-- COW versioning on every table. "Current" = superseded_by IS NULL.

CREATE TABLE IF NOT EXISTS onto_namespace (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  prefix TEXT NOT NULL, iri TEXT NOT NULL, label TEXT,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_namespace_current
  ON onto_namespace (entity_id) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_entity (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  entity_type TEXT NOT NULL, name TEXT, properties TEXT NOT NULL DEFAULT '{}',
  source_table TEXT, source_id TEXT, created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_entity_current
  ON onto_entity (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_entity_type
  ON onto_entity (entity_type) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_entity_source
  ON onto_entity (source_table, source_id);

CREATE TABLE IF NOT EXISTS onto_relation (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  subject_id TEXT NOT NULL, predicate TEXT NOT NULL, object_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0, evidence TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_relation_current
  ON onto_relation (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_relation_subject
  ON onto_relation (subject_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_relation_object
  ON onto_relation (object_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_relation_predicate
  ON onto_relation (predicate) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_alias (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  namespace TEXT NOT NULL DEFAULT 'beetree', alias TEXT NOT NULL, target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_alias_current
  ON onto_alias (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_alias_lookup
  ON onto_alias (alias) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_season_window (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  site_key TEXT NOT NULL DEFAULT 'default', phase TEXT NOT NULL,
  month_start INTEGER NOT NULL, month_end INTEGER NOT NULL,
  mean_temp_min_c REAL, mean_temp_max_c REAL, source TEXT NOT NULL DEFAULT 'vocab',
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_season_current
  ON onto_season_window (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_season_site
  ON onto_season_window (site_key, phase) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_event (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  event_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL, ended_at TEXT,
  properties TEXT NOT NULL DEFAULT '{}', confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_event_current
  ON onto_event (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_event_subject_type_time
  ON onto_event (subject_id, event_type, occurred_at) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_evidence (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  evidence_kind TEXT NOT NULL, content TEXT NOT NULL,
  source_table TEXT, source_id TEXT, recorded_at TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_evidence_current
  ON onto_evidence (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_evidence_kind_time
  ON onto_evidence (evidence_kind, recorded_at) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_instantiation (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  state_class TEXT NOT NULL, subject_id TEXT NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  supporting_evidence TEXT NOT NULL DEFAULT '[]', rationale TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_instantiation_current
  ON onto_instantiation (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_instantiation_subject_state
  ON onto_instantiation (subject_id, state_class) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_threat_species (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  species_id TEXT NOT NULL, name TEXT NOT NULL, scientific TEXT,
  kind TEXT NOT NULL,
  vectors TEXT NOT NULL DEFAULT '[]', vectored_by TEXT NOT NULL DEFAULT '[]',
  notifiable INTEGER NOT NULL DEFAULT 0, notes TEXT, seasonal_hint TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_threat_species_current
  ON onto_threat_species (entity_id) WHERE superseded_by IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_threat_species_slug
  ON onto_threat_species (species_id) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS onto_threat_alias (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT, superseded_at TEXT,
  alias TEXT NOT NULL, species_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onto_threat_alias_current
  ON onto_threat_alias (entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_onto_threat_alias_lookup
  ON onto_threat_alias (alias) WHERE superseded_by IS NULL;
