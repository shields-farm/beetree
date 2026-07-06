/**
 * Pest Control Preferences
 *
 * Stores which treatment products the beekeeper actually uses.
 * Treatment recommendations are filtered to only show preferred products.
 * Stored in localStorage so it persists across sessions.
 */

// ─── Product catalog ─────────────────────────────────────────────────────────

export interface PestProduct {
  id: string;
  name: string;
  category: 'varroa' | 'shb' | 'wax-moth' | 'nosema' | 'management';
  description: string;
  /** Server treatment.type strings that this product matches */
  matches: string[];
}

export const PEST_PRODUCTS: PestProduct[] = [
  // ─── Varroa ──────────────────────────────────────────────────────────────
  {
    id: 'oxalic-vapor',
    name: 'Oxalic Acid Vaporizer',
    category: 'varroa',
    description: 'Fast battery-powered vaporizer — best in broodless periods',
    matches: ['Oxalic Acid'],
  },
  {
    id: 'norroa',
    name: 'Norroa Strips',
    category: 'varroa',
    description: 'Oxalic acid glycerin strips — slow-release, newer option',
    matches: ['Norroa Strips', 'Oxalic Acid Strips'],
  },
  {
    id: 'formic-pro',
    name: 'Formic Pro',
    category: 'varroa',
    description: 'Formic acid strips — kills mites under capped brood',
    matches: ['Formic Pro', 'Formic Acid'],
  },
  {
    id: 'apivar',
    name: 'Apivar (amitraz)',
    category: 'varroa',
    description: '42-day treatment — low temp tolerant, no supers',
    matches: ['Apivar'],
  },
  {
    id: 'apiguard',
    name: 'Apiguard (thymol)',
    category: 'varroa',
    description: 'Thymol gel — temperature dependent',
    matches: ['Apiguard', 'Thymol'],
  },
  {
    id: 'hopguard',
    name: 'Hop Guard',
    category: 'varroa',
    description: 'Hop beta acids — can use during honey flow',
    matches: ['Hop Guard', 'Hopguard'],
  },

  // ─── Small Hive Beetle ──────────────────────────────────────────────────
  {
    id: 'beetle-blaster',
    name: 'Beetle Blaster Traps',
    category: 'shb',
    description: 'Oil-filled traps between top bars',
    matches: ['Beetle Blaster'],
  },
  {
    id: 'beetle-eater',
    name: "AJ's Beetle Eater",
    category: 'shb',
    description: 'Simple oil trap near entrance',
    matches: ["AJ's Beetle Eater", 'Beetle Eater'],
  },

  // ─── Wax Moth ────────────────────────────────────────────────────────────
  {
    id: 'certan',
    name: 'Certan (B401)',
    category: 'wax-moth',
    description: 'Bacillus thuringiensis — biological control for wax moth',
    matches: ['Certan', 'B401'],
  },

  // ─── Nosema ──────────────────────────────────────────────────────────────
  {
    id: 'fumagilin',
    name: 'Fumagilin-B',
    category: 'nosema',
    description: 'Controls Nosema apis & N. ceranae in syrup',
    matches: ['Fumagilin-B', 'Fumagilin'],
  },

  // ─── Management (always available) ────────────────────────────────────────
  {
    id: 'requeen',
    name: 'Requeening',
    category: 'management',
    description: 'Replace queen with hygienic stock',
    matches: ['Requeen'],
  },
  {
    id: 'ventilation',
    name: 'Improve Ventilation',
    category: 'management',
    description: 'Airflow management for damp hives',
    matches: ['Improve ventilation', 'ventilation'],
  },
  {
    id: 'reduce-volume',
    name: 'Reduce Hive Volume',
    category: 'management',
    description: 'Remove unused supers to help bees defend comb',
    matches: ['Reduce hive volume', 'Reduce hive volume'],
  },
];

// ─── Category metadata ────────────────────────────────────────────────────────

export const CATEGORY_META: Record<PestProduct['category'], { label: string; icon: string }> = {
  varroa: { label: 'Varroa Mites', icon: '🐛' },
  shb: { label: 'Small Hive Beetle', icon: '🪲' },
  'wax-moth': { label: 'Wax Moth', icon: '🦋' },
  nosema: { label: 'Nosema', icon: '🔬' },
  management: { label: 'Hive Management', icon: '🔧' },
};

// ─── Default preferences ───────────────────────────────────────────────────────
// Mark's defaults: oxalic vaporizer + norroa strips, no Formic Pro
const DEFAULT_PREFS: Record<string, boolean> = {
  'oxalic-vapor': true,
  'norroa': true,
  'formic-pro': false,
  'apivar': false,
  'apiguard': false,
  'hopguard': false,
  'beetle-blaster': true,
  'beetle-eater': false,
  'certan': true,
  'fumagilin': false,
  'requeen': true,
  'ventilation': true,
  'reduce-volume': true,
};

const STORAGE_KEY = 'beetree-pest-prefs';

// ─── Get / set preferences ─────────────────────────────────────────────────────

export function getPestPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults so new products get their default
      return { ...DEFAULT_PREFS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS };
}

export function setPestPrefs(prefs: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

export function togglePestPref(productId: string): Record<string, boolean> {
  const prefs = getPestPrefs();
  prefs[productId] = !prefs[productId];
  setPestPrefs(prefs);
  return prefs;
}

// ─── Filter treatments by preferences ─────────────────────────────────────────

/**
 * Check if a treatment type string matches any enabled product.
 * Management actions (requeen, ventilation, reduce-volume) are always shown.
 */
export function isTreatmentPreferred(treatmentType: string, prefs?: Record<string, boolean>): boolean {
  const p = prefs ?? getPestPrefs();

  for (const product of PEST_PRODUCTS) {
    if (!p[product.id]) continue;
    if (product.matches.some((m) => treatmentType.toLowerCase().includes(m.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

/**
 * Filter treatment recommendations to only include preferred products.
 * Warnings are always kept (disease alerts are critical regardless of product choice).
 */
export function filterTreatments(
  treatments: { type: string; timing: string; reason: string; priority: string; notes: string }[],
  prefs?: Record<string, boolean>,
): { type: string; timing: string; reason: string; priority: string; notes: string }[] {
  return treatments.filter((t) => isTreatmentPreferred(t.type, prefs));
}