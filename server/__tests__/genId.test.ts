import { describe, it, expect } from 'vitest';

// Test genId logic directly — don't import from db.ts (which opens a real DB)
function genId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

describe('genId', () => {
  it('should generate unique ids with the given prefix', () => {
    const id1 = genId('hive');
    const id2 = genId('hive');
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('hive-')).toBe(true);
  });

  it('should generate ids with default prefix', () => {
    const id = genId();
    expect(id.startsWith('id-')).toBe(true);
  });

  it('should be reasonably unique (1000 ids, no collisions)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(genId('test'));
    }
    expect(ids.size).toBe(1000);
  });
});