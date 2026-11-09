-- Migration 012: advice claims + grades — the closed loop.
--
-- Every piece of advice BeeTree gives is, in principle, a falsifiable claim:
-- "Hive 2 is running hot, check ventilation this weekend" predicts that the
-- temperature comes back down. Until now nothing recorded what was predicted,
-- so nothing could ever find out whether the advice was right.
--
-- This is the missing half of the agentic loop. server/agentic_log already
-- records what the agent DID (tool calls, messages). These tables record what
-- the agent BELIEVED and what the world turned out to be.
--
-- Two tables on purpose:
--   advice_claims        one row per claim; `grade` holds the current verdict so
--                        dashboard/stats reads stay cheap
--   advice_claim_grades  append-only audit trail; a re-grade or a human override
--                        never destroys the previous verdict
--
-- Same spirit as copy-on-write elsewhere in the schema, but simpler: a grade is
-- an immutable observation of the world, not a mutable entity.
--
-- Columns the GRADER MUST NEVER SEE:
--   rationale, confidence. A grader shown the original reasoning rationalizes
--   instead of adjudicating. adviceGrader.ts selects explicit columns; do not
--   change it to SELECT *.

CREATE TABLE IF NOT EXISTS advice_claims (
  id              TEXT PRIMARY KEY,
  hiveId          TEXT DEFAULT NULL,        -- hive entity_id; NULL = apiary-level
  hiveName        TEXT DEFAULT NULL,        -- denormalized for display
  source          TEXT NOT NULL,            -- 'buzz-chat' | 'briefing' | 'weekly-review' | 'post-inspection' | 'manual'
  chatMessageId   TEXT DEFAULT NULL,        -- chat_messages.id that carried the advice
  taskId          TEXT DEFAULT NULL,        -- tasks.entity_id created alongside the advice

  -- What the beekeeper was actually told, verbatim, and the claim in one line.
  advice          TEXT NOT NULL,
  claim           TEXT NOT NULL,

  -- The machine-checkable half. Numeric claims are graded in SQL with no model.
  metric          TEXT NOT NULL,            -- 'temperature' | 'humidity' | 'weight' | 'battery' | 'inspection' | 'observation'
  predicate       TEXT NOT NULL DEFAULT 'observed',  -- 'lt' | 'gt' | 'between' | 'observed' | 'absent'
  threshold       REAL DEFAULT NULL,
  threshold2      REAL DEFAULT NULL,        -- upper bound, for 'between'
  unit            TEXT DEFAULT NULL,        -- 'F' | '%' | 'lb' | 'V'
  basis           TEXT NOT NULL DEFAULT 'majority',  -- 'majority' | 'final' | 'any' | 'all' — how the window is reduced

  -- When the claim can be tested. window_end is the earliest valid check date;
  -- tolerance_days absorbs telemetry lag so a claim is not graded on a gap.
  window_start    TEXT NOT NULL,
  window_end      TEXT NOT NULL,
  tolerance_days  INTEGER NOT NULL DEFAULT 1,

  -- What the agent thought when it said it. rationale is for humans reading the
  -- ledger; it is deliberately withheld from the grader.
  confidence      REAL DEFAULT NULL,        -- 0..1, feeds the calibration curve
  rationale       TEXT DEFAULT NULL,

  status          TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'graded' | 'void'
  createdAt       TEXT NOT NULL,

  -- Denormalized current verdict (mirror of the newest advice_claim_grades row).
  gradedAt        TEXT DEFAULT NULL,
  grade           TEXT DEFAULT NULL,        -- 'confirmed' | 'refuted' | 'partial' | 'unverifiable'
  gradeReason     TEXT DEFAULT NULL,
  gradeBasis      TEXT DEFAULT NULL,        -- 'deterministic' | 'llm' | 'human'
  voidReason      TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_advice_claims_status_due ON advice_claims(status, window_end);
CREATE INDEX IF NOT EXISTS idx_advice_claims_hive ON advice_claims(hiveId);
CREATE INDEX IF NOT EXISTS idx_advice_claims_source ON advice_claims(source);
CREATE INDEX IF NOT EXISTS idx_advice_claims_created ON advice_claims(createdAt);
CREATE INDEX IF NOT EXISTS idx_advice_claims_task ON advice_claims(taskId);

CREATE TABLE IF NOT EXISTS advice_claim_grades (
  id          TEXT PRIMARY KEY,
  claimId     TEXT NOT NULL,
  gradedAt    TEXT NOT NULL,
  grader      TEXT NOT NULL,                -- 'deterministic' | 'llm:<model>' | 'human:<email>'
  grade       TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  observed    TEXT NOT NULL DEFAULT '{}',   -- JSON evidence packet the verdict was based on
  model       TEXT DEFAULT NULL,
  latencyMs   INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_grades_claim ON advice_claim_grades(claimId, gradedAt);
CREATE INDEX IF NOT EXISTS idx_claim_grades_grade ON advice_claim_grades(grade);
