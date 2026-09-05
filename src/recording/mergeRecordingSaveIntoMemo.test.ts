import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeRecordingSaveIntoMemo } from '@/src/recording/mergeRecordingSaveIntoMemo';
import type { Layer, Memo } from '@/src/storage/types';

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    order: 0,
    fileName: 'track.wav',
    label: 'Track 1',
    color: '#FF0000',
    startTime: 0,
    duration: 10,
    effects: { trimIn: 0, trimOut: 10 },
    ...overrides,
  };
}

function makeMemo(layers: Layer[]): Memo {
  return {
    id: 'memo-1',
    title: 'Test',
    createdAt: '2026-09-05T12:00:00.000Z',
    updatedAt: '2026-09-05T12:00:00.000Z',
    duration: layers.reduce((max, layer) => Math.max(max, layer.startTime + layer.duration), 0),
    trimStart: 0,
    trimEnd: 0,
    layers,
  };
}

describe('mergeRecordingSaveIntoMemo', () => {
  it('keeps disk trimOut when replace grows layer duration', () => {
    const current = makeMemo([
      makeLayer({
        duration: 10,
        effects: { trimIn: 0, trimOut: 10 },
        label: 'Live Label',
        color: '#00FF00',
      }),
    ]);
    const incoming = makeMemo([
      makeLayer({
        duration: 18,
        effects: { trimIn: 0, trimOut: 18 },
        label: 'Track 1',
        color: '#FF0000',
        waveformPeaks: [0.1, 0.2, 0.3],
      }),
    ]);

    const merged = mergeRecordingSaveIntoMemo(incoming, current);
    const layer = merged.layers[0]!;
    assert.equal(layer.duration, 18);
    assert.equal(layer.effects?.trimOut, 18);
    assert.equal(layer.label, 'Live Label');
    assert.equal(layer.color, '#00FF00');
    assert.deepEqual(layer.waveformPeaks, [0.1, 0.2, 0.3]);
  });

  it('preserves in-editor trim when duration is unchanged', () => {
    const current = makeMemo([
      makeLayer({
        duration: 10,
        startTime: 1.5,
        effects: { trimIn: 0.5, trimOut: 8 },
        loopUntil: 12,
      }),
    ]);
    const incoming = makeMemo([
      makeLayer({
        duration: 10,
        startTime: 0,
        effects: { trimIn: 0, trimOut: 10 },
        loopUntil: null,
      }),
    ]);

    const merged = mergeRecordingSaveIntoMemo(incoming, current);
    const layer = merged.layers[0]!;
    assert.equal(layer.duration, 10);
    assert.equal(layer.startTime, 1.5);
    assert.equal(layer.effects?.trimIn, 0.5);
    assert.equal(layer.effects?.trimOut, 8);
    assert.equal(layer.loopUntil, 12);
  });

  it('does not clobber saved first take with empty pre-record shell', () => {
    const current = makeMemo([
      makeLayer({
        duration: 0,
        effects: { trimIn: 0, trimOut: 0 },
        label: 'Track 1',
        color: '#ABCDEF',
      }),
    ]);
    const incoming = makeMemo([
      makeLayer({
        duration: 4,
        effects: { trimIn: 0, trimOut: 4 },
        label: 'Track 1',
        color: '#FF0000',
      }),
    ]);

    const merged = mergeRecordingSaveIntoMemo(incoming, current);
    const layer = merged.layers[0]!;
    assert.equal(layer.duration, 4);
    assert.equal(layer.effects?.trimOut, 4);
    assert.equal(layer.color, '#ABCDEF');
  });
});
