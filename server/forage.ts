// server/forage.ts — Forage & nectar flow forecast for Georgia / Southeast US

export interface ForageFlow {
  plant: string;
  status: 'upcoming' | 'active' | 'ending' | 'dormant';
  startMonth: string;
  endMonth: string;
  notes: string;
  significant?: boolean;
  commonness?: number; // bloom duration in months — proxy for forage availability
  latinName?: string;
  plantType?: string;
}

export interface ForageForecast {
  month: string;
  majorFlows: ForageFlow[];
  recommendation: string;
  managementTips: string[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Each plant's bloom window in Georgia (0-indexed months: 0=Jan ... 11=Dec).
// Data merged from NASA HoneyBeeNet Ayers & Harman forage map (GA_11 + GA_12 regions)
// with locally-verified beekeeping notes.
interface PlantBloom {
  plant: string;
  start: number;
  end: number;
  notes: string;
  significant?: boolean; // NASA "significant nectar source" flag
  latinName?: string;
  plantType?: string;
}

const BLOOM_CALENDAR: PlantBloom[] = [
  // ─── Winter / Early Spring (Jan–Feb) ────────────────────────────────────────
  { plant: 'Maple', start: 0, end: 4, notes: 'Early pollen source; maples can bloom in January on warm days in GA. Important for early brood build-up.', latinName: 'Acer', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Blueberry', start: 0, end: 5, notes: 'Blueberry and huckleberry provide pollen and some nectar through spring. Important for early brood build-up.', latinName: 'Vaccinium', plantType: 'Shrub (deciduous)', significant: false },
  { plant: 'Pumpkin/Squash', start: 0, end: 11, notes: 'Cultivated cucurbits bloom across the growing season; bees work them intensively when present.', latinName: 'Cucurbita', plantType: 'Crop', significant: false },
  { plant: 'Cucumber', start: 0, end: 11, notes: 'Cultivated; bees work cucumber flowers intensively when blooming.', latinName: 'Cucumis sativus', plantType: 'Crop', significant: false },
  { plant: 'Dandelion', start: 1, end: 9, notes: 'One of the longest-blooming forage plants. Pollen and nectar from February through October. Important early build-up plant.', latinName: 'Taraxacum', plantType: 'Forb', significant: false },
  { plant: 'Elm', start: 1, end: 3, notes: 'Pollen producer in late winter; helps colonies ramp up brood rearing.', latinName: 'Ulmus', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Titi', start: 1, end: 3, notes: 'Significant nectar source in southwest GA. Titi (Cliftonia) blooms Feb–Apr and can produce a surplus. Also called buckwheat tree.', latinName: 'Cliftonia monophylla', plantType: 'Tree (deciduous)', significant: true },

  // ─── Early Spring (Mar) ─────────────────────────────────────────────────────
  { plant: 'Willow', start: 2, end: 5, notes: 'Pollen and some nectar; supports early colony expansion.', latinName: 'Salix', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Redbud', start: 2, end: 3, notes: 'Ornamental/edge tree; modest nectar and pollen in early spring.', significant: false },
  { plant: 'Gallberry', start: 2, end: 5, notes: 'Significant nectar source in GA. Evergreen holly shrub of wet acidic soils. Major honey plant in the Southeast.', latinName: 'Ilex glabra', plantType: 'Shrub (evergreen)', significant: true },
  { plant: 'Tupelo', start: 2, end: 5, notes: 'Tupelo (Nyssa) — famous for premium monofloral honey from the Ogeechee River basin. Blooms Mar–Jun in GA.', latinName: 'Nyssa', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Blackberry', start: 2, end: 5, notes: 'Good nectar and pollen; brambles along field edges support colony growth.', latinName: 'Rubus', plantType: 'Shrub/Crop', significant: false },
  { plant: 'Apple', start: 2, end: 4, notes: 'Apple bloom in early spring; important pollen and nectar for colony build-up.', latinName: 'Malus', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Cherry (wild)', start: 2, end: 4, notes: 'Wild cherry provides pollen and nectar in early spring.', latinName: 'Prunus', plantType: 'Tree (deciduous)', significant: false },
  { plant: 'Box Elder', start: 2, end: 3, notes: 'Box elder (Acer negundo) provides early pollen in north GA.', latinName: 'Acer negundo', plantType: 'Tree (deciduous)', significant: false },

  // ─── Spring Main Flow (Apr–May) ──────────────────────────────────────────────
  { plant: 'Tulip Poplar', start: 3, end: 5, notes: 'Major nectar flow in the Southeast. Peak in May. One of the most important honey plants in GA. NASA-designated significant source.', latinName: 'Liriodendron tulipifera', plantType: 'Tree (deciduous)', significant: true },
  { plant: 'Crimson Clover', start: 3, end: 5, notes: 'Crimson clover (Trifolium incarnatum) — good nectar flow in late spring.', latinName: 'Trifolium incarnatum', plantType: 'Forb (legume)', significant: false },
  { plant: 'White Clover', start: 3, end: 9, notes: 'White/Dutch clover (Trifolium repens) — long nectar flow from April through October. Steady producer in pastures and lawns.', latinName: 'Trifolium repens', plantType: 'Forb (legume)', significant: false },
  { plant: 'Vetch', start: 3, end: 8, notes: 'Vetch (Vicia) provides nectar and pollen from April through September.', latinName: 'Vicia', plantType: 'Forb (legume)', significant: false },
  { plant: 'Privet', start: 3, end: 6, notes: 'Privet (Ligustrum) — significant nectar source in GA. Invasive hedge plant but bees love it. April–July bloom.', latinName: 'Ligustrum', plantType: 'Shrub', significant: true },
  { plant: 'Huckleberry', start: 3, end: 5, notes: 'Huckleberry (Gaylussacia) — pollen and nectar in spring.', latinName: 'Gaylussacia', plantType: 'Shrub', significant: false },
  { plant: 'Thistles', start: 3, end: 9, notes: 'Thistles (Cirsium) provide nectar from April through October. Bees work them heavily.', latinName: 'Cirsium', plantType: 'Forb', significant: false },

  // ─── Early Summer (May–Jun) ──────────────────────────────────────────────────
  { plant: 'Sourwood', start: 4, end: 6, notes: 'Sourwood (Oxydendrum arboreum) — significant nectar source in GA mountains. Premium monofloral honey. Blooms May–July.', latinName: 'Oxydendrum arboreum', plantType: 'Tree (deciduous)', significant: true },
  { plant: 'Basswood', start: 4, end: 6, notes: 'Basswood/Linden (Tilia) — significant nectar source in north GA. Short but intense bloom. May–July.', latinName: 'Tilia', plantType: 'Tree (deciduous)', significant: true },
  { plant: 'Palmetto', start: 4, end: 6, notes: 'Palmetto/cabbage palm (Sabal) — significant nectar in coastal/south GA. May–July.', latinName: 'Sabal', plantType: 'Tree (evergreen)', significant: true },
  { plant: 'Sumac', start: 4, end: 8, notes: 'Sumac (Rhus) provides summer nectar; helps bridge the gap after the tulip poplar flow.', latinName: 'Rhus', plantType: 'Shrub', significant: false },
  { plant: 'Prickly Pear', start: 4, end: 5, notes: 'Prickly pear cactus (Opuntia) — brief nectar source in May–June.', latinName: 'Opuntia', plantType: 'Shrub (succulent)', significant: false },
  { plant: 'Mimosa', start: 5, end: 6, notes: 'Nectar in early summer; fading by July. Invasive but bees love it.', significant: false },
  { plant: 'Watermelon', start: 4, end: 7, notes: 'Cultivated watermelon (Citrullus lanatus) — bees work flowers intensively during bloom.', latinName: 'Citrullus lanatus', plantType: 'Crop', significant: false },
  { plant: 'Cantaloupe', start: 1, end: 7, notes: 'Cultivated muskmelon (Cucumis melo) — nectar and pollen during bloom.', latinName: 'Cucumis melo', plantType: 'Crop', significant: false },

  // ─── Summer (Jun–Aug) ────────────────────────────────────────────────────────
  { plant: 'Cotton', start: 6, end: 7, notes: 'Significant nectar flow in south Georgia. Cotton honey is light and mild. Watch for pesticide exposure.', significant: false },
  { plant: 'Star Thistle', start: 5, end: 9, notes: 'Star thistle/knapweed (Centaurea) — nectar from June through October.', latinName: 'Centaurea', plantType: 'Forb', significant: false },
  { plant: 'Bermuda Grass', start: 4, end: 10, notes: 'Bermuda grass (Cynodon dactylon) — wind-pollinated but bees collect pollen from May–November.', latinName: 'Cynodon dactylon', plantType: 'Grass', significant: false },
  { plant: 'Carpet Grass', start: 4, end: 9, notes: 'Carpet grass/fogfruit (Phyla nodiflora) — nectar from May–October.', latinName: 'Phyla nodiflora', plantType: 'Forb', significant: false },

  // ─── Fall Flow (Jul–Nov) ──────────────────────────────────────────────────────
  { plant: 'Goldenrod', start: 6, end: 10, notes: 'Major fall flow; goldenrod honey is robust. NASA-confirmed July–November in GA. Critical for winter stores.', latinName: 'Solidago', plantType: 'Forb', significant: false },
  { plant: 'Aster', start: 4, end: 10, notes: 'Fall pollen and nectar; critical for winter stores. NASA-confirmed May–November in GA.', latinName: 'Aster', plantType: 'Forb', significant: false },
  { plant: 'Spanish Needle', start: 7, end: 8, notes: 'Fall nectar source in the Southeast; supports colony weight gain before winter.', significant: false },

  // ─── Late Fall / Winter (Oct–Nov) ─────────────────────────────────────────────
  { plant: 'Ivy', start: 10, end: 10, notes: 'Late-season nectar in November; can help top off winter stores.', significant: false },
];

function monthName(m: number): string {
  return MONTH_NAMES[((m % 12) + 12) % 12];
}

/** Determine the status of a plant relative to the given month. */
function plantStatus(plant: PlantBloom, month: number): ForageFlow['status'] {
  if (month < plant.start) return 'upcoming';
  if (month > plant.end) {
    // Check if it's dormant for the rest of the year relative to this month.
    return 'dormant';
  }
  // month is within [start, end]
  if (month === plant.end) return 'ending';
  if (month === plant.start) return 'active';
  return 'active';
}

function buildRecommendation(month: number, flows: ForageFlow[]): string {
  const activeCount = flows.filter((f) => f.status === 'active').length;
  const endingCount = flows.filter((f) => f.status === 'ending').length;
  const upcomingCount = flows.filter((f) => f.status === 'upcoming').length;

  if (month === 11 || month === 0) {
    return 'Dormant season in Georgia. Colonies are clustered or just beginning to raise brood. Focus on ensuring adequate winter stores and ventilation. Maples may provide a small pollen boost on warm days.';
  }
  if (activeCount === 0 && endingCount === 0 && upcomingCount === 0) {
    return 'No major flows this month — this is a dearth period. Feed colonies if stores are low and watch for robbing.';
  }
  if (activeCount > 0) {
    return monthName(month) + ' has ' + activeCount + ' active nectar flow' + (activeCount === 1 ? '' : 's') + '. Ensure supers are in place and colonies have room to store honey.';
  }
  if (endingCount > 0) {
    return 'Flows are ending this month. Prepare to harvest surplus honey if appropriate, and assess whether colonies need supplemental feeding.';
  }
  if (upcomingCount > 0) {
    return 'No active flow yet, but ' + upcomingCount + ' flow' + (upcomingCount === 1 ? ' is' : 's are') + ' upcoming. Use this time to prepare equipment and build colonies up.';
  }
  return monthName(month) + ' forage forecast.';
}

function buildManagementTips(month: number, flows: ForageFlow[]): string[] {
  const tips: string[] = [];
  const active = flows.filter((f) => f.status === 'active').map((f) => f.plant);
  const upcoming = flows.filter((f) => f.status === 'upcoming').map((f) => f.plant);
  const ending = flows.filter((f) => f.status === 'ending').map((f) => f.plant);

  // Month-specific tips
  switch (month) {
    case 0: // January
    case 1: // February
      tips.push('Check winter stores by hefting; feed fondent or candy board if light.');
      tips.push('Keep entrance reduced to prevent mouse entry and drafts.');
      tips.push('Treat for varroa with oxalic acid if brood is minimal.');
      break;
    case 2: // March
      tips.push('Begin spring build-up: feed 1:1 syrup if no natural flow yet.');
      tips.push('Add first supers as colonies expand and maples bloom.');
      tips.push('Watch for swarm cells as population builds.');
      break;
    case 3: // April
    case 4: // May
      tips.push('Add supers for the tulip poplar flow — this is the main spring honey crop in GA.');
      tips.push('Watch for swarm cells during peak flow; inspect every 7-9 days.');
      tips.push('Ensure queen has room to lay; reverse brood boxes if cluster has moved up.');
      if (month === 4) tips.push('Tulip poplar is peaking — keep supers on and stay ahead of the flow.');
      break;
    case 5: // June
      tips.push('Continue monitoring swarm cells as the flow tapers.');
      tips.push('Plan splits or increase if colonies are strong.');
      tips.push('After the main flow, assess honey stores and extract surplus.');
      break;
    case 6: // July
    case 7: // August
      tips.push('Summer dearth may begin — be ready to feed if nectar is short.');
      tips.push('Watch for robbing; reduce entrances during dearth.');
      tips.push('Monitor varroa levels; treat after honey harvest if supers are off.');
      if (active.includes('Cotton')) {
        tips.push('Cotton flow active in south GA — keep supers on but be alert to pesticide applications nearby.');
      }
      break;
    case 8: // September
      tips.push('Goldenrod and aster are flowing — this is the critical fall flow for winter stores.');
      tips.push('Do not harvest all the fall honey — leave enough for winter.');
      tips.push('Treat for varroa after supers are removed; late summer is a key treatment window.');
      break;
    case 9: // October
      tips.push('Fall flows are ending — assess colony weight and feed 2:1 syrup if light.');
      tips.push('Combine weak colonies with stronger ones before winter.');
      tips.push('Install mouse guards and reduce entrances.');
      break;
    case 10: // November
      tips.push('Final chance to feed 2:1 syrup before cold sets in.');
      tips.push('Ensure top ventilation to prevent condensation over winter.');
      tips.push('Remove queen excluders so the cluster can access honey stores.');
      break;
    case 11: // December
      tips.push('Colonies should be clustered — minimize disturbance.');
      tips.push('Check entrances are clear of debris and snow.');
      tips.push('Plan next year: order queens, package bees, and equipment.');
      break;
  }

  // Add plant-specific tips
  if (active.includes('Tulip Poplar') || upcoming.includes('Tulip Poplar')) {
    tips.push('Add supers for the tulip poplar flow.');
  }
  if (active.length > 0 && (month >= 3 && month <= 5)) {
    tips.push('Watch for swarm cells during peak flow.');
  }
  if (ending.length > 0) {
    tips.push('Flows ending: consider extracting surplus honey and assessing colony stores.');
  }

  // Dedupe while preserving order
  const seen = new Set<string>();
  return tips.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

export function getForageForecast(month?: number): ForageForecast {
  const m = month != null ? ((Number(month) - 1 + 12) % 12) : new Date().getMonth();

  const flows: ForageFlow[] = BLOOM_CALENDAR.map((plant) => {
    const status = plantStatus(plant, m);
    // Skip dormant plants entirely (they're not relevant to the current month).
    if (status === 'dormant') return null;
    return {
      plant: plant.plant,
      status,
      startMonth: monthName(plant.start),
      endMonth: monthName(plant.end),
      notes: plant.notes,
      significant: plant.significant,
      latinName: plant.latinName,
      plantType: plant.plantType,
    } as ForageFlow;
  }).filter((f): f is ForageFlow => f !== null);

  // Sort: active first, then ending, then upcoming.
  const statusRank: Record<ForageFlow['status'], number> = {
    active: 0,
    ending: 1,
    upcoming: 2,
    dormant: 3,
  };
  flows.sort((a, b) => statusRank[a.status] - statusRank[b.status]);

  return {
    month: monthName(m),
    majorFlows: flows,
    recommendation: buildRecommendation(m, flows),
    managementTips: buildManagementTips(m, flows),
  };
}

/** Get the current month's forecast plus a preview of next month. */
export function getForageForecastWithPreview(): { current: ForageForecast; next: ForageForecast } {
  const now = new Date().getMonth();
  return {
    current: getForageForecast(now + 1),
    next: getForageForecast(((now + 1) % 12) + 1),
  };
}

/** Get all forage species with bloom windows for map overlay. */
export function getAllForageSpecies(): ForageFlow[] {
  const now = new Date().getMonth();
  return BLOOM_CALENDAR.map((plant) => {
    const status = plantStatus(plant, now);
    const duration = plant.end >= plant.start ? plant.end - plant.start + 1 : (12 - plant.start) + plant.end + 1;
    return {
      plant: plant.plant,
      status,
      startMonth: monthName(plant.start),
      endMonth: monthName(plant.end),
      notes: plant.notes,
      significant: plant.significant,
      commonness: duration, // months of bloom — higher = more commonly available
      latinName: plant.latinName,
      plantType: plant.plantType,
    } as ForageFlow;
  }).sort((a, b) => {
    // Sort: significant first, then by commonness (longer bloom = more common), then by start month
    if (a.significant && !b.significant) return -1;
    if (!a.significant && b.significant) return 1;
    const diff = (b.commonness || 0) - (a.commonness || 0);
    if (diff !== 0) return diff;
    return 0;
  });
}