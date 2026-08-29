import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  layerTimelineSignature,
  loadedLayerTimelineChanged,
} from '@/src/audio/engineLayerTimeline';

test('layerTimelineSignature is order-sensitive', () => {
  const a = [
    { id: '1', path: '/a.wav' },
    { id: '2', path: '/b.wav' },
  ];
  const b = [
    { id: '2', path: '/b.wav' },
    { id: '1', path: '/a.wav' },
  ];
  assert.notEqual(layerTimelineSignature(a), layerTimelineSignature(b));
});

test('loadedLayerTimelineChanged detects add/remove', () => {
  const before = [{ id: '1', path: '/a.wav' }];
  const after = [
    { id: '1', path: '/a.wav' },
    { id: '2', path: '/b.wav' },
  ];
  assert.equal(loadedLayerTimelineChanged(before, before), false);
  assert.equal(loadedLayerTimelineChanged(before, after), true);
});

test('loadedLayerTimelineChanged detects path change for same id', () => {
  const before = [{ id: '1', path: '/a.wav' }];
  const after = [{ id: '1', path: '/a-replaced.wav' }];
  assert.equal(loadedLayerTimelineChanged(before, after), true);
});
