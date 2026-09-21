/**
 * BeeStick cadence scheduler — hub side of the v1.1 protocol.
 *
 * The sensor can't know season or time of day (no calendar, and it sits
 * inside a dark hive), so the hub owns the sampling schedule and writes
 * it to the sensor over GATT at every sync. Lead time is the product;
 * cadence is how you manufacture it (Ellis-corpus brief, Sept 2026).
 *
 * Class table mirrors firmware beestick_v1.ino v1.1 EXACTLY — any drift
 * between the two sides means mislabeled telemetry. If one changes,
 * both change, in the same commit.
 */

// Cadence classes (status flags bits 5-7 in the telemetry packet)
export const CADENCE_CLASSES = {
  0: 'winter_day',
  1: 'winter_night',
  2: 'shoulder_day',
  3: 'shoulder_night',
  4: 'swarm_day',
  5: 'swarm_night',
  6: 'transition',
  7: 'event_burst',
} as const;
export type CadenceClassId = keyof typeof CADENCE_CLASSES;

// Intervals in seconds — MUST match firmware CAD_*_SEC defines
export const CADENCE_INTERVALS: Record<CadenceClassId, number> = {
  0: 1800, // winter_day     30 min
  1: 1800, // winter_night   30 min — NOT reduced: cluster integrity is the winter signal
  2: 600,  // shoulder_day   10 min
  3: 1800, // shoulder_night 30 min
  4: 300,  // swarm_day       5 min — swarm issues cluster mid-morning
  5: 1200, // swarm_night    20 min
  6: 300,  // transition      5 min inside dawn/dusk ±30min windows
  7: 60,   // event_burst    60 s post-event follow-up
};

export interface CadenceSchedule {
  seasonProfile: 0 | 1 | 2;  // 0=winter 1=shoulder 2=swarm-season
  sunriseMin: number;        // local minutes-of-day
  sunsetMin: number;         // local minutes-of-day
  intervalSec: number;       // resolved interval for RIGHT NOW
  cadenceClass: CadenceClassId;
  cadenceName: string;
}

/** Season profile from calendar month (Northern Hemisphere). */
export function seasonProfileFor(month: number): 0 | 1 | 2 {
  // Swarm season: May-June. Winter: Dec-Feb. Shoulder: everything else.
  if (month === 4 || month === 5) return 2;      // JS months are 0-indexed: 4=May, 5=Jun
  if (month === 11 || month <= 1) return 0;      // 11=Dec, 0=Jan, 1=Feb
  return 1;
}

/** ISO sunrise/sunset (from weather forecast) -> local minutes-of-day. */
export function isoToMinutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Resolve the cadence schedule for an apiary at a moment in time.
 * Transition windows (dawn/dusk ±30 min) override season+daypart in
 * every profile: colony behavior changes state at transitions — flight
 * cessation, evening bearding, orientation flights.
 */
export function resolveCadence(
  seasonProfile: 0 | 1 | 2,
  sunriseMin: number,
  sunsetMin: number,
  now = new Date()
): CadenceSchedule {
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const isNight = minutesOfDay < sunriseMin || minutesOfDay >= sunsetMin;

  const near = (target: number) =>
    Math.abs(minutesOfDay - target) <= 30;

  let cadenceClass: CadenceClassId;
  if (near(sunriseMin) || near(sunsetMin)) {
    cadenceClass = 6; // transition window
  } else if (seasonProfile === 0) {
    // winter: day and night both 30 min — cluster watch
    cadenceClass = isNight ? 1 : 0;
  } else if (seasonProfile === 1) {
    cadenceClass = isNight ? 3 : 2;
  } else {
    cadenceClass = isNight ? 5 : 4;
  }

  return {
    seasonProfile,
    sunriseMin,
    sunsetMin,
    intervalSec: CADENCE_INTERVALS[cadenceClass],
    cadenceClass,
    cadenceName: CADENCE_CLASSES[cadenceClass],
  };
}

/**
 * Build the GATT config payload the firmware's syncCadenceFromHub()
 * expects: season profile, sunrise/sunset minutes-of-day, and the
 * current minutes-of-day as the RTC anchor.
 */
export function buildCadenceConfigPayload(schedule: CadenceSchedule, now = new Date()): {
  seasonProfile: number;
  sunriseMin: number;
  sunsetMin: number;
  minutesOfDay: number; // RTC anchor for the sensor
} {
  return {
    seasonProfile: schedule.seasonProfile,
    sunriseMin: schedule.sunriseMin,
    sunsetMin: schedule.sunsetMin,
    minutesOfDay: now.getHours() * 60 + now.getMinutes(),
  };
}