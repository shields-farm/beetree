// Invariant test for the replay tool preflight.
//
// Regression for 2026-11-10: three replay episodes returned inspect/wait advice
// with zero recorded claims because record_advice_claim was not in the schema set
// exposed to the model. The episode still scored, so the ledger stayed empty while
// the report looked complete. The preflight must reject that before a model call.

import { describe, expect, it } from 'vitest';
import { assertRequiredTools } from '../rlEpisodeWorker.js';

const tool = (name: string) => ({ function: { name } });

describe('replay preflight: required tools must be reachable', () => {
  it('throws when record_advice_claim is absent', () => {
    expect(() => assertRequiredTools([tool('get_hives'), tool('get_sensors')]))
      .toThrow(/record_advice_claim/);
  });

  it('throws when get_hives is absent', () => {
    expect(() => assertRequiredTools([tool('record_advice_claim')]))
      .toThrow(/get_hives/);
  });

  it('names every missing tool, not just the first', () => {
    expect(() => assertRequiredTools([tool('get_sensors')]))
      .toThrow(/record_advice_claim.*get_hives|get_hives.*record_advice_claim/);
  });

  it('refuses an empty tool set instead of scoring an empty ledger', () => {
    expect(() => assertRequiredTools([])).toThrow(/Refusing to score/);
  });

  it('accepts a tool set that can record claims', () => {
    expect(() => assertRequiredTools([
      tool('get_hives'),
      tool('record_advice_claim'),
      tool('get_sensors'),
    ])).not.toThrow();
  });

  it('does not mistake a malformed schema for the required tool', () => {
    // {name: ...} without the function wrapper must not count as exposed.
    expect(() => assertRequiredTools([
      { name: 'record_advice_claim' },
      tool('get_hives'),
    ])).toThrow(/record_advice_claim/);
  });
});
