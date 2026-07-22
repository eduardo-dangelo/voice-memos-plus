import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { snapTimeToGrid } from '@/src/audio/loopSnap';

describe('snapTimeToGrid', () => {
  it('snaps to the nearest grid interval', () => {
    assert.equal(snapTimeToGrid(0.4, 0.5, 10), 0.5);
    assert.equal(snapTimeToGrid(0.2, 0.5, 10), 0);
    assert.equal(snapTimeToGrid(1.24, 0.5, 10), 1);
    assert.equal(snapTimeToGrid(1.26, 0.5, 10), 1.5);
  });

  it('clamps to duration', () => {
    assert.equal(snapTimeToGrid(10.4, 0.5, 10), 10);
    assert.equal(snapTimeToGrid(-1, 0.5, 10), 0);
  });

  it('returns clamped time when interval is invalid', () => {
    assert.equal(snapTimeToGrid(3.2, 0, 10), 3.2);
    assert.equal(snapTimeToGrid(12, -1, 10), 10);
  });
});
