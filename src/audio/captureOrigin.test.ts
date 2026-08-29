import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  measuredCueLeadFromOrigin,
  updateCaptureOriginFromBuffer,
} from './captureOrigin';

describe('updateCaptureOriginFromBuffer', () => {
  it('back-extrapolates sample 0 from the first delivered buffer', () => {
    const origin = updateCaptureOriginFromBuffer({
      previousOrigin: 0,
      contextTimeAtDelivery: 1.1,
      framesDeliveredIncludingThis: 4410,
      bufferFrameCount: 4410,
      sampleRate: 44100,
    });
    assert.equal(origin, 1.0);
  });

  it('keeps the earlier origin when later deliveries are late', () => {
    const first = updateCaptureOriginFromBuffer({
      previousOrigin: 0,
      contextTimeAtDelivery: 1.1,
      framesDeliveredIncludingThis: 4410,
      bufferFrameCount: 4410,
      sampleRate: 44100,
    });
    const second = updateCaptureOriginFromBuffer({
      previousOrigin: first,
      contextTimeAtDelivery: 1.25,
      framesDeliveredIncludingThis: 8820,
      bufferFrameCount: 4410,
      sampleRate: 44100,
    });
    assert.equal(second, first);
  });

  it('ignores session-relative when (~0) so clocks are not mixed', () => {
    const origin = updateCaptureOriginFromBuffer({
      previousOrigin: 0,
      contextTimeAtDelivery: 2.1,
      framesDeliveredIncludingThis: 4410,
      bufferFrameCount: 4410,
      sampleRate: 44100,
      eventWhen: 0.01,
    });
    assert.equal(origin, 2.0);
  });
});

describe('measuredCueLeadFromOrigin', () => {
  it('uses capture origin when present', () => {
    assert.ok(Math.abs(measuredCueLeadFromOrigin(1.02, 1.0, 0.99) - 0.02) < 1e-9);
  });

  it('falls back to recorder.start stamp', () => {
    assert.ok(Math.abs(measuredCueLeadFromOrigin(1.02, 0, 1.0) - 0.02) < 1e-9);
  });

  it('returns 0 when cue was never armed', () => {
    assert.equal(measuredCueLeadFromOrigin(0, 1.0, 1.0), 0);
  });
});
