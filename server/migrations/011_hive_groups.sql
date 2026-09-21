-- Migration 011: Hive groups (yard groupings, e.g. the "Ellis Special")
-- A group is a named, ordered arrangement of hives in an apiary — the physical
-- layout of colonies in the yard. The canonical example is Jamie Ellis's
-- pairing: two production hives with a nuc between them ("Ellis Special").
-- Membership is stored on the hive row (groupId) for cheap joins; the group row
-- keeps the ordered member list + template so the visual layout can be rendered
-- and the group can be edited/regrouped later.
CREATE TABLE IF NOT EXISTS hive_groups (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  superseded_at TEXT,
  apiaryId      TEXT NOT NULL,
  name          TEXT NOT NULL,
  template      TEXT NOT NULL DEFAULT 'custom',
  notes         TEXT,
  createdAt     TEXT NOT NULL,
  members       TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_hive_groups_entity ON hive_groups(entity_id);
CREATE INDEX IF NOT EXISTS idx_hive_groups_current ON hive_groups(entity_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_hive_groups_apiary ON hive_groups(apiaryId) WHERE superseded_by IS NULL;

-- Hive -> group membership. Nullable: a hive not in a group is standalone.
-- No FK on purpose: hives are copy-on-write and the delete path already runs
-- with foreign_keys=OFF to cascade across versions; a plain column keeps
-- deletes symmetric (group delete clears the column via the API route).
ALTER TABLE hives ADD COLUMN groupId TEXT;