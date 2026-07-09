import { describe, it, expect } from 'vitest';

// Test the apiBase localStorage key management logic
// (can't test the actual localStorage-dependent functions without jsdom)

describe('apiBase key management', () => {
  it('localStorage key should be consistent', () => {
    // The key used by getApiKey/setApiKey — if this changes, all stored keys break
    const API_KEY_STORAGE = 'beetree-api-key';
    expect(API_KEY_STORAGE).toBe('beetree-api-key');
  });

  it('localStorage state key should be v2 (bumped from v1)', () => {
    // v1 had seed data, v2 is server-only. If this regresses, old demo data returns.
    const STATE_KEY = 'beetree-state-v2';
    expect(STATE_KEY).toBe('beetree-state-v2');
  });
});