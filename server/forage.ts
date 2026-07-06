// server/forage.ts — Forage & nectar flow forecast for Georgia / Southeast US

export interface ForageFlow {
  plant: string;
  status: 'upcoming' | 'active' | 'ending' | 'dormant';
  startMonth: string;
  endMonth: string;
  notes: string;
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
interface PlantBloom {
  plant: string;
  start: number;
  end: number;
  notes: string;
}

const BLOOM_CALENDAR: PlantBloom[] = [
  { plant: 'Maple', start: 0, end: 2, notes: 'Early pollen source; maples can bloom in January on warm days in GA. Important for early brood build-up.' },
  { plant: 'Elm', start: 1, end: 2, notes: 'Pollen producer in late winter; helps colonies ramp up brood rearing.' },
  { plant: 'Willow', start: 2, end: 3, notes: 'Pollen and some nectar; supports early colony expansion.' },
  { plant: 'Redbud', start: 2, end: 3, notes: 'Ornamental/edge tree; modest nectar and pollen in early spring.' },
  { plant: 'Tulip Poplar', start: 3, end: 5, notes: 'Major nectar flow in the Southeast. Peak in May. One of the most important honey plants in GA.' },
  { plant: 'Blackberry', start: 3, end: 4, notes: 'Good nectar and pollen; brambles along field edges support colony growth.' },
  { plant: 'Clover', start: 3, end: 5, notes: 'White and red clover provide a steady nectar flow through late spring. Begins in April.' },
  { plant: 'Sumac', start: 5, end: 6, notes: 'Summer nectar source; helps bridge the gap after the tulip poplar flow.' },
  { plant: 'Mimosa', start: 5, end: 6, notes: 'Nectar in early summer; fading by July. Invasive but bees love it.' },
  { plant: 'Cotton', start: 6, end: 7, notes: 'Significant nectar flow in south Georgia. Cotton honey is light and mild. Watch for pesticide exposure.' },
  { plant: 'Goldenrod', start: 7, end: 9, notes: 'Major fall flow; goldenrod honey is robust. Begins late August, peaks September, fades October.' },
  { plant: 'Aster', start: 8, end: 10, notes: 'Fall pollen and nectar; critical for winter stores. Fades by November.' },
  { plant: 'Spanish Needle', start: 8, end: 9, notes: 'Fall nectar source in the Southeast; supports colony weight gain before winter.' },
  { plant: 'Ivy', start: 10, end: 10, notes: 'Late-season nectar in November; can help top off winter stores.' },
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