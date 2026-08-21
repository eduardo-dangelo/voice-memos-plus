import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextLayerOrder } from '@/src/storage/layerOrder';
import type { Layer, Memo } from '@/src/storage/types';

function layer(order: number, id = `layer-${order}`): Layer {
  return {
    id,
    order,
    fileName: `layer-${order}.m4a`,
    label: `Track ${order + 1}`,
    startTime: 0,
    duration: 1,
  };
}

function memo(layers: Layer[]): Memo {
  return {
    id: 'memo-1',
    title: 'Test',
    createdAt: '',
    updatedAt: '',
    duration: 1,
    layers,
  };
}

describe('nextLayerOrder', () => {
  test('returns max order plus one after delete leaves gaps', () => {
    const m = memo([layer(0, 'a'), layer(5, 'b')]);
    assert.equal(nextLayerOrder(m), 6);
  });

  test('returns 0 for empty memo', () => {
    assert.equal(nextLayerOrder(memo([])), 0);
  });

  test('new stack order sorts above surviving tracks visually', () => {
    const m = memo([layer(0, 'a'), layer(5, 'b')]);
    const newOrder = nextLayerOrder(m);
    const sorted = [...m.layers, layer(newOrder, 'c')].sort(
      (a, b) => b.order - a.order
    );
    assert.equal(sorted[0]?.id, 'c');
  });
});
