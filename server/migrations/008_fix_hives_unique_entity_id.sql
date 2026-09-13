-- `hives` carried an unconditional UNIQUE index on entity_id
-- (idx_hives_entity_unique). That makes copy-on-write impossible: superseding a
-- hive inserts a second row with the same entity_id, which the index rejects
-- with "UNIQUE constraint failed: hives.entity_id".
--
-- Every other versioned table (and every onto_* table) uses the partial form
-- `WHERE superseded_by IS NULL`, which enforces one *current* row per entity
-- while still allowing the version history. This restores that pattern.
--
-- Consequence before the fix: editing a hive returned HTTP 500 from
-- cowSupersede, so `superseded_by IS NULL` was true for every row in the DB and
-- no hive had ever moved past version 1.

DROP INDEX IF EXISTS idx_hives_entity_unique;

-- One current row per entity; historical versions remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hives_current_unique
  ON hives (entity_id) WHERE superseded_by IS NULL;

-- The old non-unique index is now redundant with the unique partial index.
DROP INDEX IF EXISTS idx_hives_entity;
