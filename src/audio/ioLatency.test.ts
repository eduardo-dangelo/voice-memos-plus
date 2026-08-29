import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isUsableLatencySec,
  resolveIoLatencySeconds,
} from './ioLatency';

describe('isUsableLatencySec', () => {
  it('accepts typical iOS I/O latencies', () => {
    assert.equal(isUsableLatencySec(0.012), true);
    assert.equal(isUsableLatencySec(0.15), true);
  });

  it('rejects zero, NaN, and huge values', () => {
    assert.equal(isUsableLatencySec(0), false);
    assert.equal(isUsableLatencySec(0.0004), false);
    assert.equal(isUsableLatencySec(Number.NaN), false);
    assert.equal(isUsableLatencySec(1.5), false);
    assert.equal(isUsableLatencySec(undefined), false);
  });
});

describe('resolveIoLatencySeconds', () => {
  it('prefers audio-api host values over the session', () => {
    const resolved = resolveIoLatencySeconds({
      contextOutputLatency: 0.08,
      recorderInputLatency: 0.01,
      sessionInputLatency: 0.05,
      sessionOutputLatency: 0.2,
    });
    assert.equal(resolved.inputLatencySec, 0.01);
    assert.equal(resolved.outputLatencySec, 0.08);
    assert.equal(resolved.measured, true);
  });

  it('falls back to AVAudioSession when host values are missing', () => {
    const resolved = resolveIoLatencySeconds({
      sessionInputLatency: 0.011,
      sessionOutputLatency: 0.014,
    });
    assert.equal(resolved.inputLatencySec, 0.011);
    assert.equal(resolved.outputLatencySec, 0.014);
    assert.equal(resolved.measured, true);
  });

  it('uses baseLatency only when outputLatency is absent', () => {
    const withOutput = resolveIoLatencySeconds({
      contextOutputLatency: 0.02,
      contextBaseLatency: 0.005,
    });
    assert.equal(withOutput.outputLatencySec, 0.02);

    const baseOnly = resolveIoLatencySeconds({
      contextBaseLatency: 0.005,
    });
    assert.equal(baseOnly.outputLatencySec, 0.005);
  });

  it('returns zeros when nothing usable is reported', () => {
    const resolved = resolveIoLatencySeconds({
      sessionInputLatency: 0,
      sessionOutputLatency: 0,
    });
    assert.equal(resolved.inputLatencySec, 0);
    assert.equal(resolved.outputLatencySec, 0);
    assert.equal(resolved.measured, false);
  });
});
