-- 007_chat_history.sql — server-side chat sessions + messages (all lanes)
-- Deliberately NOT COW-versioned: chat messages are immutable append-only rows.
-- Versioning every message would be pointless churn. Sessions soft-delete instead.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  lane TEXT NOT NULL DEFAULT 'chat' CHECK (lane IN ('chat','buzz-thread')),
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
  ON chat_sessions (lane, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  thinking TEXT,
  follow_ups_json TEXT,
  lane TEXT NOT NULL DEFAULT 'chat' CHECK (lane IN ('chat','buzz-thread')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (session_id, created_at);