import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db.js';
import { adviceCoverage } from '../adviceCoverage.js';
import { createClaim } from '../adviceClaims.js';

const NOW = '2026-11-09T12:00:00.000Z';

function message(
  id: string,
  content: string,
  toolCalls: unknown[] | null = null,
  createdAt = NOW,
): void {
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, tool_calls_json, lane, created_at)
     VALUES (?, 'session-test', 'assistant', ?, ?, 'chat', ?)`,
  ).run(id, content, toolCalls ? JSON.stringify(toolCalls) : null, createdAt);
}

beforeEach(() => {
  db.exec('DELETE FROM advice_claim_grades');
  db.exec('DELETE FROM advice_claims');
  db.exec('DELETE FROM chat_messages');
  db.exec('DELETE FROM chat_sessions');
  db.prepare(
    "INSERT INTO chat_sessions (id, title, lane, created_at, updated_at) VALUES ('session-test', 'Test', 'chat', ?, ?)",
  ).run(NOW, NOW);
});

describe('adviceCoverage', () => {
  it('reports null coverage on an empty history', () => {
    const report = adviceCoverage(db, NOW);
    expect(report.messages.assistant).toBe(0);
    expect(report.messages.coverageRate).toBeNull();
    expect(report.claims.total).toBe(0);
    expect(report.note).toMatch(/No advice claims/);
  });

  it('counts only actionable/predictive messages in the review denominator', () => {
    message('m-plain', 'Capped brood contains developing pupae.');
    message('m-gap', 'You should inspect Hive Alpha this weekend.');
    message('m-covered', 'Hive Alpha is likely running hot; check ventilation.', [{
      name: 'record_advice_claim',
      args: '{}',
      result: '{"ok":true,"claimId":"claim-1"}',
    }]);
    createClaim({
      source: 'buzz-chat', chatMessageId: 'm-covered',
      advice: 'Check ventilation', claim: 'Temperature falls below 99F',
      metric: 'observation', windowEnd: '2026-11-16T12:00:00.000Z',
    });

    const report = adviceCoverage(db, NOW);
    expect(report.messages.assistant).toBe(3);
    expect(report.messages.actionableOrPredictive).toBe(2);
    expect(report.messages.withRecordedClaimTool).toBe(1);
    expect(report.messages.coverageRate).toBe(0.5);
    expect(report.recentGaps.map(g => g.id)).toEqual(['m-gap']);
    expect(report.claims.total).toBe(1);
    expect(report.claims.linkedToChatMessage).toBe(1);
  });

  it('does not count a failed claim validation as coverage', () => {
    message('m-failed', 'Inspect the hive and check the queen.', [{
      name: 'record_advice_claim',
      result: '{"error":"threshold is required"}',
    }]);
    const report = adviceCoverage(db, NOW);
    expect(report.messages.actionableOrPredictive).toBe(1);
    expect(report.messages.withRecordedClaimTool).toBe(0);
    expect(report.messages.coverageRate).toBe(0);
  });

  it('supports the original OpenAI tool-call shape as well as the UI log shape', () => {
    message('m-openai', 'The colony is likely queenless; inspect for eggs.', [{
      function: { name: 'record_advice_claim', arguments: '{}' },
      result: '{"claimId":"claim-2"}',
    }]);
    expect(adviceCoverage(db, NOW).messages.withRecordedClaimTool).toBe(1);
  });
});
