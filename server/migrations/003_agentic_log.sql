-- Migration: Add agentic_log table for tracking all agentic activity
-- Stores briefings, nudges, post-inspection actions, tool calls, alerts

CREATE TABLE IF NOT EXISTS agentic_log (
  id          TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  type        TEXT NOT NULL,           -- 'briefing', 'weekly-review', 'post-inspection', 'nudge', 'alert', 'tool-call', 'feeding-nudge', 'weight-alert'
  source      TEXT NOT NULL,           -- 'morning-briefing', 'weekly-review', 'post-inspection', 'buzz-chat', 'feeding-loop', 'weight-loop'
  hiveId      TEXT DEFAULT NULL,       -- optional: related hive
  hiveName    TEXT DEFAULT NULL,       -- denormalized for quick display
  title       TEXT NOT NULL,           -- short title
  body        TEXT DEFAULT '',         -- full message/body
  severity    TEXT NOT NULL DEFAULT 'info',  -- 'info', 'warning', 'urgent'
  metadata    TEXT DEFAULT '{}',       -- JSON blob for extra context (tool args, inspection ID, etc.)
  delivered   INTEGER NOT NULL DEFAULT 0,  -- 1 if delivered to Slack, 0 if not
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agentic_log_ts ON agentic_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_agentic_log_type ON agentic_log(type);
CREATE INDEX IF NOT EXISTS idx_agentic_log_hive ON agentic_log(hiveId);
CREATE INDEX IF NOT EXISTS idx_agentic_log_severity ON agentic_log(severity);