import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampTrimValues, MIN_TRIM_SELECTION, TRIM_SNAP_SECONDS } from '@/src/audio/layerEffects';

describe('clampTrimValues', () => {
  it('quantizes to TRIM_SNAP_SECONDS by default', () => {
    const next = clampTrimValues(1.04, 3.06, 10);
    assert.equal(next.trimIn, Math.round(1.04 / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS);
    assert.equal(next.trimOut, Math.round(3.06 / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS);
  });

  it('skips quantization when quantizeSec is null', () => {
    const next = clampTrimValues(1.04, 3.06, 10, null);
    assert.equal(next.trimIn, 1.04);
    assert.equal(next.trimOut, 3.06);
  });

  it('still enforces min selection without quantization', () => {
    const next = clampTrimValues(2, 2.1, 10, null);
    assert.equal(next.trimIn, 2);
    assert.equal(next.trimOut, 2 + MIN_TRIM_SELECTION);
  });
});
