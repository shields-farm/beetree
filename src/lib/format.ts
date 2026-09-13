import { formatDistanceToNow, format, isValid } from 'date-fns';

/** A reading older than this is treated as stale, not live. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface Freshness {
  /** Whole hours since the timestamp (Infinity when unparseable). */
  ageMs: number;
  ageHours: number;
  /** True when the timestamp predates STALE_AFTER_MS. */
  stale: boolean;
  /** "just now" / "3h ago" / "2 months ago" */
  relative: string;
  /** "Jul 27, 2026" — always shown alongside the relative form when stale. */
  absolute: string;
}

/**
 * Single source of truth for "how old is this reading".
 *
 * BeeTree previously rendered `formatDistanceToNow` straight into a section
 * captioned "Live Sensors", so 48-day-old readings were labelled "live" with
 * nothing flagging them. Every surface that shows a timestamp should route
 * through this so staleness is consistent.
 */
export function freshness(iso: string | null | undefined): Freshness | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (!isValid(t)) return null;
  const ageMs = Math.max(0, Date.now() - t.getTime());
  return {
    ageMs,
    ageHours: ageMs / 3_600_000,
    stale: ageMs > STALE_AFTER_MS,
    relative: formatDistanceToNow(t, { addSuffix: true }),
    absolute: format(t, 'MMM d, yyyy'),
  };
}

/** Compact age for dense rows: "just now" / "3h ago" / "5d ago" / "Jul 27". */
export function shortAge(iso: string | null | undefined): string {
  const f = freshness(iso);
  if (!f) return '';
  const h = f.ageHours;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return f.absolute;
}

/**
 * "2:1 syrup" — turn a feed ratio + stored feed-type id into prose.
 *
 * The feeding alert used to interpolate the raw id and produce
 * "Consider feeding 2:1 syrup-2:1".
 */
export function describeFeed(ratio: string | null | undefined, type: string | null | undefined): string {
  const ratioStr = (ratio ?? '').trim();
  const raw = (type ?? '').trim();
  const name = raw.replace(/^syrup-/, '').replace(/-/g, ' ');
  if (!ratioStr && !name) return 'syrup';
  if (!ratioStr) return name;
  if (!name || name === ratioStr) return `${ratioStr} syrup`;
  return `${ratioStr} ${name}`;
}
