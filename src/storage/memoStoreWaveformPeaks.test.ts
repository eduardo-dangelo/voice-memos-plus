import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  layerWaveformPeaksAreCurrent,
  peakCountForDuration,
} from '@/src/audio/waveform';

function makeLayer(overrides: {
  duration?: number;
  waveformPeaks?: number[];
} = {}) {
  const duration = overrides.duration ?? 10;
  return {
    duration,
    waveformPeaks:
      overrides.waveformPeaks ??
      Array.from({ length: peakCountForDuration(duration) }, () => 0.5),
  };
}

describe('layerWaveformPeaksAreCurrent', () => {
  it('accepts design-density peaks when file duration matches', () => {
    const layer = makeLayer();
    assert.equal(layerWaveformPeaksAreCurrent(layer, 10), true);
  });

  it('accepts peaks within ±2 bars of design density', () => {
    const duration = 30;
    const layer = makeLayer({
      duration,
      waveformPeaks: Array.from({ length: peakCountForDuration(duration) - 1 }, () => 0.4),
    });
    assert.equal(layerWaveformPeaksAreCurrent(layer, duration), true);
  });

  it('rejects sparse peaks that would need upsampling', () => {
    const layer = makeLayer({
      duration: 30,
      waveformPeaks: Array.from({ length: 32 }, () => 0.5),
    });
    assert.equal(layerWaveformPeaksAreCurrent(layer, 30), false);
  });

  it('rejects when file duration disagrees beyond tolerance', () => {
    const layer = makeLayer({ duration: 10 });
    assert.equal(layerWaveformPeaksAreCurrent(layer, 12), false);
  });

  it('rejects missing peaks', () => {
    const layer = { duration: 10, waveformPeaks: undefined };
    assert.equal(layerWaveformPeaksAreCurrent(layer, 10), false);
  });

  it('rejects zero-duration layers', () => {
    const layer = makeLayer({ duration: 0, waveformPeaks: [] });
    assert.equal(layerWaveformPeaksAreCurrent(layer, 0), false);
  });
});
