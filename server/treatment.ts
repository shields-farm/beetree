// server/treatment.ts — Treatment recommender based on concerns + season + temp

import { db, type HiveRow, type InspectionRow } from './db.js';

export interface TreatmentRecommendation {
  hiveId: string;
  hiveName: string;
  treatments: {
    type: string;
    timing: string;
    reason: string;
    temperatureRange: string;
    priority: 'high' | 'medium' | 'low';
    notes: string;
  }[];
  season: string;
  warnings: string[];
}

interface ConcernRow {
  id: string;
  inspectionId: string;
  type: string;
  count: number | null;
  note: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function currentMonth(): number {
  return new Date().getMonth(); // 0-indexed
}

function seasonFor(month: number): string {
  if (month === 2 || month === 3 || month === 4) return 'Spring';
  if (month === 5 || month === 6 || month === 7) return 'Summer';
  if (month === 8 || month === 9 || month === 10) return 'Fall';
  return 'Winter';
}

/** Rough Georgia daytime temperature range by month (°F). */
function tempRangeFor(month: number): string {
  // [low, high] typical daytime temps for Georgia
  const ranges: Record<number, [number, number]> = {
    0: [40, 60],   // January
    1: [45, 65],   // February
    2: [55, 75],   // March
    3: [60, 80],   // April
    4: [65, 85],   // May
    5: [70, 90],   // June
    6: [75, 92],   // July
    7: [75, 92],   // August
    8: [65, 85],   // September
    9: [55, 78],   // October
    10: [45, 68],  // November
    11: [40, 60],  // December
  };
  const [lo, hi] = ranges[month] ?? [60, 80];
  return lo + '-' + hi + '\u00B0F';
}

function normalizeConcernType(type: string): string {
  return type.toLowerCase().replace(/[-_]/g, ' ').trim();
}

/** Build treatment entries for a single concern type given the season/month. */
function treatmentsForConcern(
  concernType: string,
  concernNote: string,
  month: number,
): TreatmentRecommendation['treatments'] {
  const t = normalizeConcernType(concernType);
  const season = seasonFor(month);
  const tempRange = tempRangeFor(month);
  const out: TreatmentRecommendation['treatments'] = [];

  // --- Varroa ---
  if (t.includes('varroa') || t.includes('mite')) {
    if (season === 'Winter') {
      // No brood — oxalic acid vapor/drip is most effective.
      out.push({
        type: 'Oxalic Acid',
        timing: 'Apply now, next 10 days — winter (no brood) is the ideal window',
        reason: 'Varroa mites detected. With no brood present, oxalic acid can kill phoretic mites effectively.',
        temperatureRange: '40-55\u00B0F (best below brood-rearing temps)',
        priority: 'high',
        notes: 'Vapor or trickle method. Do NOT use when brood is present — it only kills phoretic mites. Repeat once after 7 days if mite load is high.',
      });
    } else if (season === 'Spring' || season === 'Summer') {
      out.push({
        type: 'Formic Pro',
        timing: 'Apply now, next 10 days',
        reason: 'Varroa mites detected during active season. Formic Pro kills mites under capped brood.',
        temperatureRange: '50-85\u00B0F',
        priority: 'high',
        notes: 'Two treatment strips, 10-day treatment. Must remove during dearth if daytime highs exceed 85\u00B0F. Can use honey supers during treatment.',
      });
    }
    if (season === 'Spring' || season === 'Fall') {
      out.push({
        type: 'Apivar',
        timing: season === 'Spring' ? 'Apply now — 42-day treatment needed before flow' : 'Apply now — 42-day treatment before winter',
        reason: 'Alternative varroa treatment for ' + season.toLowerCase() + '. Apivar (amitraz) is effective and low-temperature tolerant.',
        temperatureRange: '50-95\u00B0F',
        priority: 'medium',
        notes: 'Requires 42-day treatment period plus 14-day withdrawal before honey harvest. Plan ahead. Do not use during nectar flow if honey will be harvested.',
      });
    }
  }

  // --- Small Hive Beetle ---
  if (t.includes('hive beetle') || t.includes('shb') || t.includes('beetle')) {
    if (month >= 3 && month <= 9) {
      // Warm months
      out.push({
        type: 'Beetle Blaster',
        timing: 'Install now, check every 7-10 days',
        reason: 'Small Hive Beetles detected. Beetle Blaster traps catch adults in oil.',
        temperatureRange: tempRange,
        priority: 'medium',
        notes: 'Fill halfway with mineral or vegetable oil. Place between top bars. Replace when full or after 2-3 weeks.',
      });
      out.push({
        type: "AJ's Beetle Eater",
        timing: 'Install now, check weekly',
        reason: 'Alternative SHB trap — simple oil-filled design effective in warm months.',
        temperatureRange: tempRange,
        priority: 'low',
        notes: 'Position near the entrance or between frames where beetles congregate. Keep oil level topped up.',
      });
    } else {
      out.push({
        type: 'Beetle Blaster',
        timing: 'Monitor — beetle pressure is lower in cool months',
        reason: 'Small Hive Beetles noted. Maintain traps; activity is reduced in winter.',
        temperatureRange: tempRange,
        priority: 'low',
        notes: 'SHB reproduce slowly below 60\u00B0F. Keep traps in place but check less frequently.',
      });
    }
  }

  // --- Wax Moth ---
  if (t.includes('wax moth') || t.includes('waxmoth')) {
    if (month >= 2 && month <= 5) {
      out.push({
        type: 'Certan (B401)',
        timing: 'Apply now to stored comb and weak colonies',
        reason: 'Wax moth detected. Certan is a biological control (Bacillus thuringiensis) for wax moth larvae.',
        temperatureRange: tempRange,
        priority: 'medium',
        notes: 'Spray on drawn comb. Most effective as a preventive in spring before moth populations peak. Safe for bees.',
      });
    }
    out.push({
      type: 'Reduce hive volume',
      timing: 'Remove unused supers immediately',
      reason: 'Wax moths thrive in unprotected comb and oversized hive bodies. Reduce space the bees must patrol.',
      temperatureRange: 'Any',
      priority: 'high',
      notes: 'Remove drawn comb from colonies that cannot protect it. Store comb properly (freezing, moth balls/Certan, or cold storage).',
    });
  }

  // --- Chalkbrood ---
  if (t.includes('chalkbrood') || t.includes('chalk brood')) {
    out.push({
      type: 'Requeen',
      timing: 'Plan requeening within 4-6 weeks',
      reason: 'Chalkbrood is often linked to a queen with poor genetics or a stressed colony. Requeening with a resistant stock frequently resolves it.',
      temperatureRange: tempRange,
      priority: 'medium',
      notes: 'Order a hygienic-bred queen. Removing the old queen and introducing new genetics is the most reliable long-term fix.',
    });
    out.push({
      type: 'Improve ventilation',
      timing: 'Do it now',
      reason: 'Chalkbrood flourishes in damp, poorly ventilated hives. Increase airflow to dry out the brood nest.',
      temperatureRange: 'Any',
      priority: 'medium',
      notes: 'Tip the hive slightly forward to drain condensation. Add a screened bottom board or ventilation shim. Remove mummified larvae from the bottom board.',
    });
  }

  // --- AFB / EFB ---
  if (t.includes('afb') || t.includes('efb') || t.includes('foulbrood') || t.includes('american foulbrood') || t.includes('european foulbrood')) {
    const isAFB = t.includes('afb') || t.includes('american foulbrood');
    out.push({
      type: isAFB ? 'Report to apiary inspector IMMEDIATELY' : 'Contact apiary inspector',
      timing: 'Today — do not wait',
      reason: (isAFB ? 'American' : 'European') + ' Foulbrood is a reportable disease. AFB spores persist for 50+ years and require official action.',
      temperatureRange: 'Any',
      priority: 'high',
      notes: isAFB
        ? 'AFB is a notifiable disease in most states. Do NOT move equipment. Stop here and call your state apiary inspector before doing anything else.'
        : 'EFB is often stress-related and may resolve with requeening and improved nutrition, but confirm with an inspector. Antibiotic treatment (oxytetracycline) may be prescribed.',
    });
    if (isAFB) {
      out.push({
        type: 'Burn / irradiate infected equipment',
        timing: 'After inspector confirms diagnosis',
        reason: 'AFB spores cannot be eliminated by antibiotics alone. Infected frames and comb must be destroyed or irradiated.',
        temperatureRange: 'Any',
        priority: 'high',
        notes: 'Follow inspector guidance. Burning infected colonies and equipment is the legal requirement in many states. Irradiation is an alternative for woodenware.',
      });
    }
  }

  // --- Nosema ---
  if (t.includes('nosema')) {
    if (season === 'Spring' || season === 'Fall') {
      out.push({
        type: 'Fumagilin-B',
        timing: season === 'Spring' ? 'Apply now, 2 rounds of treatment in spring' : 'Apply now, fall treatment before winter cluster',
        reason: 'Nosema detected. Fumagilin-B controls Nosema apis and N. ceranae when brood is present.',
        temperatureRange: tempRange,
        priority: 'medium',
        notes: 'Mix with sugar syrup (1:1 in spring, 2:1 in fall). Two treatments 4 days apart. Do not use during honey flow. No longer approved in some regions — check local regulations.',
      });
    } else {
      out.push({
        type: 'Fumagilin-B',
        timing: 'Plan treatment for spring or fall — not ideal in ' + season.toLowerCase(),
        reason: 'Nosema detected, but Fumagilin is most effective in spring/fall. Monitor and treat at the next window.',
        temperatureRange: tempRange,
        priority: 'low',
        notes: 'Reduce stress and ensure good nutrition in the meantime. If dysentery is visible, consider moving treatment forward.',
      });
    }
  }

  return out;
}

/** Get the latest inspection for a hive, or null if none. */
function getLatestInspection(hiveId: string): InspectionRow | null {
  const rows = db
    .prepare('SELECT * FROM inspections WHERE hiveId = ? ORDER BY date DESC LIMIT 1')
    .all(hiveId) as InspectionRow[];
  return rows.length > 0 ? rows[0] : null;
}

function getConcernsFor(inspectionId: string): ConcernRow[] {
  return db.prepare('SELECT * FROM concerns WHERE inspectionId = ?').all(inspectionId) as ConcernRow[];
}

export function getTreatmentRecommendation(hiveId: string): TreatmentRecommendation {
  const hive = db.prepare('SELECT * FROM hives WHERE id = ?').get(hiveId) as HiveRow | undefined;
  if (!hive) {
    throw new Error('hive not found: ' + hiveId);
  }
  const month = currentMonth();
  const season = seasonFor(month);

  const latest = getLatestInspection(hiveId);
  const treatments: TreatmentRecommendation['treatments'] = [];
  const warnings: string[] = [];

  if (!latest) {
    return {
      hiveId: hive.id,
      hiveName: hive.name,
      treatments: [],
      season,
      warnings: ['No inspection history for this hive — inspect to enable treatment recommendations.'],
    };
  }

  const concerns = getConcernsFor(latest.id);

  if (concerns.length === 0) {
    return {
      hiveId: hive.id,
      hiveName: hive.name,
      treatments: [],
      season,
      warnings: [],
    };
  }

  // Deduplicate treatments by type to avoid duplicates from multiple concerns
  const seenTypes = new Set<string>();
  for (const c of concerns) {
    const note = c.note ?? '';
    const newTreatments = treatmentsForConcern(c.type, note, month);
    for (const t of newTreatments) {
      if (!seenTypes.has(t.type)) {
        seenTypes.add(t.type);
        treatments.push(t);
      }
    }
  }

  // Sort treatments by priority (high first)
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  treatments.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  // Warnings for serious diseases
  const concernTypesLower = concerns.map((c) => normalizeConcernType(c.type));
  if (concernTypesLower.some((t) => t.includes('afb') || t.includes('american foulbrood'))) {
    warnings.push('AFB suspected — contact your apiary inspector immediately. Do not move equipment or share tools.');
  }
  if (concernTypesLower.some((t) => t.includes('efb') || t.includes('european foulbrood'))) {
    warnings.push('EFB suspected — contact your apiary inspector for confirmation and treatment guidance.');
  }
  if (concernTypesLower.some((t) => t.includes('varroa') || t.includes('mite'))) {
    const varroaConcern = concerns.find((c) => normalizeConcernType(c.type).includes('varroa') || normalizeConcernType(c.type).includes('mite'));
    const count = varroaConcern?.count ?? null;
    if (count != null && count >= 10) {
      warnings.push('High varroa mite count (' + count + ') — treat promptly to prevent colony collapse and virus transmission.');
    }
  }

  return {
    hiveId: hive.id,
    hiveName: hive.name,
    treatments,
    season,
    warnings,
  };
}

export function getAllTreatmentRecommendations(): TreatmentRecommendation[] {
  const hives = db.prepare('SELECT id FROM hives').all() as { id: string }[];
  const recs: TreatmentRecommendation[] = [];
  for (const h of hives) {
    try {
      const rec = getTreatmentRecommendation(h.id);
      // Only include hives that actually have treatments or warnings.
      if (rec.treatments.length > 0 || rec.warnings.length > 0) {
        recs.push(rec);
      }
    } catch (e) {
      console.error('[treatment] error for hive ' + h.id + ':', e);
    }
  }
  // Sort: hives with high-priority treatments first.
  recs.sort((a, b) => {
    const aHigh = a.treatments.some((t) => t.priority === 'high') || a.warnings.length > 0;
    const bHigh = b.treatments.some((t) => t.priority === 'high') || b.warnings.length > 0;
    if (aHigh !== bHigh) return aHigh ? -1 : 1;
    return b.treatments.length - a.treatments.length;
  });
  return recs;
}

/** Exported for the forage endpoint to reuse the season label. */
export { seasonFor, tempRangeFor, MONTH_NAMES };