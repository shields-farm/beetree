// server/agenticLog.ts — Agentic activity log: track all nudges, briefings,
// alerts, tool calls, and post-inspection actions. Searchable via API.

import { db, genId } from './db.js';

export interface AgenticLogEntry {
  id: string;
  timestamp: string;
  type: string;          // 'briefing', 'weekly-review', 'post-inspection', 'nudge', 'alert', 'tool-call', 'feeding-nudge', 'weight-alert'
  source: string;         // 'morning-briefing', 'weekly-review', 'post-inspection', 'buzz-chat', 'feeding-loop', 'weight-loop'
  hiveId: string | null;
  hiveName: string | null;
  title: string;
  body: string;
  severity: string;       // 'info', 'warning', 'urgent'
  metadata: Record<string, any>;
  delivered: boolean;
}

/** Log an agentic event. */
export function logAgenticEvent(params: {
  type: string;
  source: string;
  title: string;
  body?: string;
  hiveId?: string | null;
  hiveName?: string | null;
  severity?: string;
  metadata?: Record<string, any>;
  delivered?: boolean;
}): AgenticLogEntry {
  const id = genId('alog');
  const timestamp = new Date().toISOString();
  const {
    type,
    source,
    title,
    body = '',
    hiveId = null,
    hiveName = null,
    severity = 'info',
    metadata = {},
    delivered = false,
  } = params;

  db.prepare(
    `INSERT INTO agentic_log (id, timestamp, type, source, hiveId, hiveName, title, body, severity, metadata, delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, timestamp, type, source, hiveId, hiveName, title, body, severity, JSON.stringify(metadata), delivered ? 1 : 0, timestamp);

  return { id, timestamp, type, source, hiveId, hiveName, title, body, severity, metadata, delivered };
}

/** Query the agentic log with optional filters. */
export function queryAgenticLog(params: {
  limit?: number;
  offset?: number;
  type?: string;
  source?: string;
  hiveId?: string;
  severity?: string;
  search?: string;  // Full-text search on title + body
  since?: string;   // ISO timestamp — only entries after this
  until?: string;   // ISO timestamp — only entries before this
}): { entries: AgenticLogEntry[]; total: number } {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions: string[] = [];
  const args: any[] = [];

  if (params.type) { conditions.push('type = ?'); args.push(params.type); }
  if (params.source) { conditions.push('source = ?'); args.push(params.source); }
  if (params.hiveId) { conditions.push('hiveId = ?'); args.push(params.hiveId); }
  if (params.severity) { conditions.push('severity = ?'); args.push(params.severity); }
  if (params.since) { conditions.push('timestamp >= ?'); args.push(params.since); }
  if (params.until) { conditions.push('timestamp <= ?'); args.push(params.until); }
  if (params.search) {
    conditions.push('(title LIKE ? OR body LIKE ?)');
    args.push(`%${params.search}%`, `%${params.search}%`);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = (db.prepare(`SELECT COUNT(*) as c FROM agentic_log ${where}`).get(...args) as { c: number }).c;

  const rows = db
    .prepare(`SELECT * FROM agentic_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as any[];

  const entries: AgenticLogEntry[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    type: r.type,
    source: r.source,
    hiveId: r.hiveId,
    hiveName: r.hiveName,
    title: r.title,
    body: r.body,
    severity: r.severity,
    metadata: r.metadata ? JSON.parse(r.metadata) : {},
    delivered: r.delivered === 1,
  }));

  return { entries, total };
}

/** Get a single log entry by ID. */
export function getAgenticLogEntry(id: string): AgenticLogEntry | null {
  const row = db.prepare('SELECT * FROM agentic_log WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    source: row.source,
    hiveId: row.hiveId,
    hiveName: row.hiveName,
    title: row.title,
    body: row.body,
    severity: row.severity,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    delivered: row.delivered === 1,
  };
}

/** Get agentic log stats — counts by type, severity, source. */
export function getAgenticLogStats(): {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  last24h: number;
  last7d: number;
} {
  const total = (db.prepare('SELECT COUNT(*) as c FROM agentic_log').get() as { c: number }).c;

  const typeRows = db.prepare('SELECT type, COUNT(*) as c FROM agentic_log GROUP BY type').all() as { type: string; c: number }[];
  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.type] = r.c;

  const sevRows = db.prepare('SELECT severity, COUNT(*) as c FROM agentic_log GROUP BY severity').all() as { severity: string; c: number }[];
  const bySeverity: Record<string, number> = {};
  for (const r of sevRows) bySeverity[r.severity] = r.c;

  const srcRows = db.prepare('SELECT source, COUNT(*) as c FROM agentic_log GROUP BY source').all() as { source: string; c: number }[];
  const bySource: Record<string, number> = {};
  for (const r of srcRows) bySource[r.source] = r.c;

  const now = Date.now();
  const h24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last24h = (db.prepare('SELECT COUNT(*) as c FROM agentic_log WHERE timestamp >= ?').get(h24) as { c: number }).c;
  const last7d = (db.prepare('SELECT COUNT(*) as c FROM agentic_log WHERE timestamp >= ?').get(d7) as { c: number }).c;

  return { total, byType, bySeverity, bySource, last24h, last7d };
}