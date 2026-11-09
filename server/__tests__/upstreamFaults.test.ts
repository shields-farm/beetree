// Tests for the upstream-fault classifier.
//
// The behaviour this protects: the assistant's own storage failure must be read
// as an outage, not as an answer. Mark hit exactly that — the DeletedWalGeneration
// paragraph arrived as `message.content`, so BeeTree rendered it in the chat
// bubble and would have stored it as the assistant's reply.
//
// The other half matters just as much: a normal beekeeping answer that happens to
// contain the word "database" must NOT be swallowed.

import { describe, it, expect } from 'vitest';
import { isTransientStorageFault, STORAGE_FAULT_MESSAGE } from '../upstreamFaults.js';

describe('isTransientStorageFault', () => {
  it('recognises the exact text that reached the beekeeper', () => {
    const real =
      "Sorry, I encountered an error (DeletedWalGenerationError).\n" +
      'FATAL: session storage stopped writing because another Hermes process still holds ' +
      'a deleted state.db-wal or state.db-shm inode (an old copy of the write-ahead log). ' +
      'Nothing is lost: quit every Hermes process on this profile.';
    expect(isTransientStorageFault(real)).toBe(true);
  });

  it('recognises the sibling fault classes', () => {
    expect(isTransientStorageFault('StateDbReplacedError: generation replaced')).toBe(true);
    expect(isTransientStorageFault('StateDbCorruptError')).toBe(true);
    expect(isTransientStorageFault('SqliteError: database is locked')).toBe(true);
    expect(isTransientStorageFault('sqlite3.DatabaseError: database disk image is malformed')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isTransientStorageFault('deletedwalgenerationerror')).toBe(true);
  });

  it('does not swallow an ordinary answer about a database', () => {
    expect(isTransientStorageFault(
      'Your hive records are stored in a local SQLite database on the BeeTree hub, so nothing leaves the farm.',
    )).toBe(false);
  });

  it('does not swallow a normal recommendation', () => {
    expect(isTransientStorageFault('Inspect Hive Alpha this week — 109 days is too long.')).toBe(false);
  });

  it('is safe on empty input', () => {
    expect(isTransientStorageFault('')).toBe(false);
    expect(isTransientStorageFault(null)).toBe(false);
    expect(isTransientStorageFault(undefined)).toBe(false);
  });

  it('never leaks the error class into the user-facing message', () => {
    expect(STORAGE_FAULT_MESSAGE).not.toMatch(/Error|state\.db|WAL/i);
    expect(STORAGE_FAULT_MESSAGE).toMatch(/try again/i);
  });
});
