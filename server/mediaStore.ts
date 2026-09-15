// server/mediaStore.ts — filesystem-backed media storage.
//
// Media captured by glasses or the phone camera is written to data/media/ and
// referenced by a relative URL, instead of being inlined as a base64 data URL
// in SQLite. See migrations/010_media_files.sql for the reasoning.
//
// Layout:
//   data/media/<entity_id>.jpg      the image
//   media_items.file_path           the basename, for deletion
//   media_items.dataUrl             '/media/<entity_id>.jpg' (what the UI renders)
//
// Legacy rows whose dataUrl still starts with 'data:' are untouched and keep
// rendering from the inline value.

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MEDIA_DIR = process.env.BEETREE_MEDIA_DIR
  ? resolve(process.env.BEETREE_MEDIA_DIR)
  : resolve(__dirname, '..', 'data', 'media');

mkdirSync(MEDIA_DIR, { recursive: true });

/** Public URL prefix the Express static route serves MEDIA_DIR under. */
export const MEDIA_URL_PREFIX = '/media';

/**
 * How many photos to keep per hive. Capture is continuous on glasses, so
 * unbounded growth is the default failure mode. 0 disables pruning.
 * Override with BEETREE_MEDIA_KEEP.
 */
export const MEDIA_KEEP_PER_HIVE = Number(process.env.BEETREE_MEDIA_KEEP ?? 100);

export function mediaDir(): string {
  return MEDIA_DIR;
}

/**
 * Reject anything that isn't a plain basename, so a crafted entity_id or URL
 * can never escape MEDIA_DIR via '..'.
 */
export function isSafeMediaName(name: string): boolean {
  if (!name || name.length > 128) return false;
  if (name !== basename(name)) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('.')) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/** Absolute path for a stored media file, or null if the name is unsafe/absent. */
export function resolveMediaPath(filePath: string): string | null {
  if (!isSafeMediaName(filePath)) return null;
  const full = resolve(MEDIA_DIR, filePath);
  // Belt and braces: the resolved path must still sit inside MEDIA_DIR.
  if (!full.startsWith(MEDIA_DIR + '/')) return null;
  return full;
}

/** Write raw image bytes and return the name, URL, and byte size. */
export function saveMediaBytes(
  entityId: string,
  bytes: Buffer,
  ext = 'jpg',
): { filePath: string; url: string; bytes: number } {
  const safeId = entityId.replace(/[^A-Za-z0-9._-]/g, '_');
  const filePath = `${safeId}.${ext}`;
  const full = resolveMediaPath(filePath);
  if (!full) throw new Error(`Unsafe media filename: ${filePath}`);
  writeFileSync(full, bytes);
  return { filePath, url: `${MEDIA_URL_PREFIX}/${filePath}`, bytes: bytes.length };
}

/**
 * Decode a base64 data URL (or bare base64) to bytes and store it.
 * Returns null when the input is not decodable image data.
 */
export function saveDataUrl(
  entityId: string,
  dataUrl: string,
): { filePath: string; url: string; bytes: number } | null {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl.trim());
  let ext = 'jpg';
  let payload: string;
  if (m) {
    ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    payload = m[2];
  } else {
    // Bare base64 — assume JPEG, which is what every camera path produces.
    payload = dataUrl.trim();
  }
  // Guard against absurd inline payloads before allocating.
  if (payload.length < 16 || payload.length > 64 * 1024 * 1024) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (bytes.length < 8) return null;
  return saveMediaBytes(entityId, bytes, ext);
}

/** True when a dataUrl value is servable as an image path (stored or legacy inline). */
export function isServableMediaUrl(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false;
  return v.startsWith('data:') || v.startsWith(MEDIA_URL_PREFIX + '/');
}

/** Delete a stored file. Missing files are not an error. */
export function deleteMediaFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const full = resolveMediaPath(filePath);
  if (!full || !existsSync(full)) return false;
  try {
    unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune stored files for a hive, keeping the newest `keep` rows.
 * Called after each capture so the disk budget stays bounded without a cron.
 * Returns the number of files removed.
 */
export function pruneHiveMedia(
  rows: { file_path: string | null; dataUrl: string }[],
  keep: number = MEDIA_KEEP_PER_HIVE,
): number {
  if (!keep || keep <= 0) return 0;
  let removed = 0;
  for (const r of rows.slice(keep)) {
    const name = r.file_path ?? (r.dataUrl.startsWith(`${MEDIA_URL_PREFIX}/`)
      ? r.dataUrl.slice(MEDIA_URL_PREFIX.length + 1)
      : null);
    if (name && deleteMediaFile(name)) removed++;
  }
  return removed;
}
