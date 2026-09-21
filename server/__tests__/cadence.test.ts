// Tests for the BeeStick v1.1 cadence scheduler (server/cadence.ts).
//
// The class table MUST mirror the firmware (beestick_v1.ino v1.1 CAD_* defines)
// exactly — any drift between hub and sensor means mislabeled telemetry. These
// tests pin the decision table, the transition-window override, winter-night
// parity (cluster integrity is the winter signal — nights are NOT reduced),
// and the GATT payload shape.

import { describe, it, expect } from 'vitest';
import {
  CADENCE_CLASSES,
  CADENCE_INTERVALS,
  seasonProfileFor,
  isoToMinutesOfDay,
  resolveCadence,
  buildCadenceConfigPayload,
} from '../cadence.js';

// Helper: a Date at a given local time on a fixed day (DST-immune in tests
// because we construct wall-clock times directly).
function at(hour: number, min = 0, month = 5): Date {
  // month=5 -> June (swarm season default); tests that care pass their own
  return new Date(2026, month, 15, hour, min, 0, 0);
}

describe('cadence interval table matches firmware v1.1', () => {
  it('winter day and night are both 30 min', () => {
    expect(CADENCE_INTERVALS[0]).toBe(1800);
    expect(CADENCE_INTERVALS[1]).toBe(1800);
  });
  it('swarm day is the fastest class at 5 min', () => {
    expect(CADENCE_INTERVALS[4]).toBe(300);
    expect(Math.min(...Object.values(CADENCE_INTERVALS))).toBe(60); // event burst
    expect(CADENCE_INTERVALS[4]).toBeLessThan(CADENCE_INTERVALS[2]); // swarm < shoulder day
  });
  it('transition windows are 5 min', () => {
    expect(CADENCE_INTERVALS[6]).toBe(300);
  });
  it('all 8 classes named', () => {
    expect(Object.keys(CADENCE_CLASSES)).toHaveLength(8);
  });
});

describe('seasonProfileFor', () => {
  it('May and June are swarm season', () => {
    expect(seasonProfileFor(4)).toBe(2);
    expect(seasonProfileFor(5)).toBe(2);
  });
  it('Dec, Jan, Feb are winter', () => {
    expect(seasonProfileFor(11)).toBe(0);
    expect(seasonProfileFor(0)).toBe(0);
    expect(seasonProfileFor(1)).toBe(0);
  });
  it('Mar, Sep, Oct, Nov are shoulder', () => {
    expect(seasonProfileFor(2)).toBe(1);
    expect(seasonProfileFor(8)).toBe(1);
    expect(seasonProfileFor(9)).toBe(1);
    expect(seasonProfileFor(10)).toBe(1);
  });
});

describe('isoToMinutesOfDay', () => {
  it('converts an ISO time to local minutes-of-day', () => {
    const d = new Date(2026, 5, 15, 7, 22, 0);
    expect(isoToMinutesOfDay(d.toISOString())).toBe(7 * 60 + 22);
  });
});

describe('resolveCadence decision table', () => {
  // Georgia-ish sunrise 6:30 (390), sunset 8:30 (1230)
  const sunrise = 390, sunset = 1230;

  it('mid-morning in swarm season -> swarm_day', () => {
    const s = resolveCadence(2, sunrise, sunset, at(10, 0));
    expect(s.cadenceClass).toBe(4);
    expect(s.cadenceName).toBe('swarm_day');
    expect(s.intervalSec).toBe(300);
  });

  it('swarm-season night -> swarm_night', () => {
    const s = resolveCadence(2, sunrise, sunset, at(23, 0));
    expect(s.cadenceClass).toBe(5);
    expect(s.intervalSec).toBe(1200);
  });

  it('winter day and night resolve to equal intervals (cluster watch)', () => {
    const day = resolveCadence(0, sunrise, sunset, at(12, 0));
    const night = resolveCadence(0, sunrise, sunset, at(2, 0));
    expect(day.intervalSec).toBe(night.intervalSec); // the whole point
    expect(day.cadenceClass).toBe(0);
    expect(night.cadenceClass).toBe(1);
  });

  it('dawn window overrides season+daypart (transition)', () => {
    const s = resolveCadence(0, sunrise, sunset, at(6, 30));
    expect(s.cadenceClass).toBe(6);
    expect(s.intervalSec).toBe(300);
  });

  it('dusk window overrides too', () => {
    const s = resolveCadence(2, sunrise, sunset, at(20, 30));
    expect(s.cadenceClass).toBe(6);
  });

  it('edge of transition window (±30 min) still transition', () => {
    expect(resolveCadence(1, sunrise, sunset, at(6, 0)).cadenceClass).toBe(6);
    expect(resolveCadence(1, sunrise, sunset, at(7, 0)).cadenceClass).toBe(6);
    expect(resolveCadence(1, sunrise, sunset, at(7, 1)).cadenceClass).not.toBe(6);
  });

  it('shoulder day -> shoulder_day 10 min', () => {
    const s = resolveCadence(1, sunrise, sunset, at(14, 0));
    expect(s.cadenceClass).toBe(2);
    expect(s.intervalSec).toBe(600);
  });
});

describe('buildCadenceConfigPayload', () => {
  it('carries the RTC anchor and schedule for the sensor', () => {
    const s = resolveCadence(2, 390, 1230, at(9, 15));
    const payload = buildCadenceConfigPayload(s, at(9, 15));
    expect(payload).toEqual({
      seasonProfile: 2,
      sunriseMin: 390,
      sunsetMin: 1230,
      minutesOfDay: 9 * 60 + 15,
    });
  });
});