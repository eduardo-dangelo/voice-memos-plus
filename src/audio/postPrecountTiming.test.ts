import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computePostPrecountContextWhen,
  POST_PRECOUNT_SCHEDULE_LEAD_SEC,
} from './postPrecountTiming';

const INTERVAL_MS = 500;
const FOUR_BEATS_MS = 4 * INTERVAL_MS;

function baseInput(overrides: {
  contextStart?: number | null;
  live?: number | null;
  startMs?: number;
  beat1DeadlineMs?: number;
  nowMs?: number;
}) {
  const startMs = overrides.startMs ?? 1_000;
  return {
    contextStart: overrides.contextStart ?? 10,
    live: overrides.live ?? 10 + FOUR_BEATS_MS / 1000 + 0.05,
    startMs,
    beat1DeadlineMs: overrides.beat1DeadlineMs ?? startMs + FOUR_BEATS_MS,
    intervalMs: INTERVAL_MS,
    nowMs: overrides.nowMs ?? startMs + FOUR_BEATS_MS + 50,
    scheduleLeadSec: POST_PRECOUNT_SCHEDULE_LEAD_SEC,
  };
}

describe('computePostPrecountContextWhen', () => {
  it('returns planned downbeat when tracked and still before audio downbeat', () => {
    const startMs = 1_000;
    const input = baseInput({
      contextStart: 10,
      live: 11.95,
      startMs,
      beat1DeadlineMs: startMs + FOUR_BEATS_MS,
      nowMs: startMs + FOUR_BEATS_MS - 50,
    });
    const planned = input.contextStart! + FOUR_BEATS_MS / 1000;
    assert.equal(computePostPrecountContextWhen(input), planned);
  });

  it('returns immediate start when tracked and wall downbeat already passed', () => {
    const input = baseInput({});
    assert.equal(
      computePostPrecountContextWhen(input),
      input.live! + POST_PRECOUNT_SCHEDULE_LEAD_SEC
    );
  });

  it('returns immediate start when the audio clock stayed frozen', () => {
    const input = baseInput({
      contextStart: 10,
      live: 10,
      nowMs: 1_000 + FOUR_BEATS_MS + 50,
    });
    assert.equal(
      computePostPrecountContextWhen(input),
      10 + POST_PRECOUNT_SCHEDULE_LEAD_SEC
    );
  });

  it('returns immediate start when wall downbeat already passed', () => {
    const input = baseInput({
      contextStart: 10,
      live: 12.1,
      startMs: 1_000,
      beat1DeadlineMs: 1_000 + FOUR_BEATS_MS,
      nowMs: 1_000 + FOUR_BEATS_MS + 300,
    });
    assert.equal(
      computePostPrecountContextWhen(input),
      12.1 + POST_PRECOUNT_SCHEDULE_LEAD_SEC
    );
  });

  it('returns null when contextStart or live is null', () => {
    assert.equal(
      computePostPrecountContextWhen({ ...baseInput({}), contextStart: null }),
      null
    );
    assert.equal(
      computePostPrecountContextWhen({ ...baseInput({}), live: null }),
      null
    );
  });

  it('falls back when the audio clock is slightly behind wall precount', () => {
    const input = baseInput({
      contextStart: 10,
      live: 11.85,
      nowMs: 1_000 + FOUR_BEATS_MS + 50,
    });
    assert.equal(
      computePostPrecountContextWhen(input),
      11.85 + POST_PRECOUNT_SCHEDULE_LEAD_SEC
    );
  });
});
