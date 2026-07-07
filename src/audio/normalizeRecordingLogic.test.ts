import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeNormalizeFromRate,
  recordingNeedsNormalize,
  TARGET_SAMPLE_RATE,
} from './normalizeRecordingLogic';

describe('computeNormalizeFromRate', () => {
  it('skips resample for 44100 file with matching duration', () => {
    const result = computeNormalizeFromRate(44100, 5, 5, TARGET_SAMPLE_RATE);
    assert.equal(result.shouldResample, false);
    assert.equal(result.fromRate, 44100);
  });

  it('resamples 48000 header to 44100 when duration matches', () => {
    const result = computeNormalizeFromRate(48000, 5, 5, TARGET_SAMPLE_RATE);
    assert.equal(result.shouldResample, true);
    assert.equal(result.fromRate, 48000);
  });

  it('infers lower rate when buffer duration is short vs recorder', () => {
    const result = computeNormalizeFromRate(44100, 2.5, 5, TARGET_SAMPLE_RATE);
    assert.equal(result.shouldResample, true);
    assert.ok(result.fromRate < 44100);
  });

  it('does not use hardware hints — 44100 file stays unchanged', () => {
    const result = computeNormalizeFromRate(44100, 4.945, 4.945, TARGET_SAMPLE_RATE);
    assert.equal(result.shouldResample, false);
  });
});

describe('recordingNeedsNormalize', () => {
  it('returns false for correct 44100 recording', () => {
    assert.equal(recordingNeedsNormalize(44100, 4.945, 4.945), false);
  });

  it('returns true for 48000 file header', () => {
    assert.equal(recordingNeedsNormalize(48000, 5, 5), true);
  });

  it('returns true when duration ratio indicates mismatch', () => {
    assert.equal(recordingNeedsNormalize(44100, 2.5, 5), true);
  });
});
