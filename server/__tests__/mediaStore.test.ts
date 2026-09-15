// server/__tests__/mediaStore.test.ts
//
// Path handling for stored capture media. The traversal cases are the point:
// media names reach the filesystem from a URL path, so '..' must be impossible
// rather than merely unlikely.

import { describe, it, expect } from 'vitest';
import { isSafeMediaName, resolveMediaPath, mediaDir, MEDIA_KEEP_PER_HIVE } from '../mediaStore.js';

describe('isSafeMediaName', () => {
  it('accepts the names the store generates', () => {
    expect(isSafeMediaName('media-abc123xyz.jpg')).toBe(true);
    expect(isSafeMediaName('cap-1_2-3.png')).toBe(true);
  });

  it('rejects anything that could climb out of the media directory', () => {
    expect(isSafeMediaName('../secrets.jpg')).toBe(false);
    expect(isSafeMediaName('..')).toBe(false);
    expect(isSafeMediaName('a/../../etc/passwd')).toBe(false);
    expect(isSafeMediaName('/etc/passwd')).toBe(false);
    expect(isSafeMediaName('sub/dir.jpg')).toBe(false);
    expect(isSafeMediaName('back\\slash.jpg')).toBe(false);
  });

  it('rejects hidden files, empties, and absurd lengths', () => {
    expect(isSafeMediaName('.hidden.jpg')).toBe(false);
    expect(isSafeMediaName('')).toBe(false);
    expect(isSafeMediaName('a'.repeat(200) + '.jpg')).toBe(false);
  });
});

describe('resolveMediaPath', () => {
  it('resolves a safe name inside the media directory', () => {
    const p = resolveMediaPath('media-abc.jpg');
    expect(p).not.toBeNull();
    expect(p!.endsWith('/media-abc.jpg')).toBe(true);
    // Must land inside the configured media dir, whichever one that is (the unit
    // suite points it at a per-worker temp dir).
    expect(p!.startsWith(mediaDir())).toBe(true);
  });

  it('returns null for unsafe names instead of a path', () => {
    expect(resolveMediaPath('../beetree.db')).toBeNull();
    expect(resolveMediaPath('/etc/passwd')).toBeNull();
  });
});

describe('retention', () => {
  it('defaults to a bounded per-hive budget', () => {
    // A 12MP JPEG is ~4-6MB. 100 per hive keeps a hive's capture history under
    // roughly half a gigabyte, which is what a 64GB Pi microSD can afford.
    expect(MEDIA_KEEP_PER_HIVE).toBeGreaterThan(0);
    expect(MEDIA_KEEP_PER_HIVE).toBeLessThanOrEqual(500);
  });
});
