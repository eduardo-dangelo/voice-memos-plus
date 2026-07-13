import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Memo } from '@/src/storage/types';

function makeMemo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: 'memo-1',
    title: 'New Recording Jul 13, 4:24 PM',
    createdAt: '2026-07-13T16:24:00.000Z',
    updatedAt: '2026-07-13T16:24:00.000Z',
    duration: 0,
    trimStart: 0,
    trimEnd: 0,
    layers: [],
    ...overrides,
  };
}

describe('manual rename protection', () => {
  it('treats missing titleSource as eligible for auto naming', () => {
    const memo = makeMemo();
    assert.notEqual(memo.titleSource, 'user');
  });

  it('blocks auto naming when titleSource is user', () => {
    const memo = makeMemo({ titleSource: 'user', title: 'My Interview' });
    assert.equal(memo.titleSource, 'user');
  });

  it('allows auto naming when titleSource is default or location', () => {
    assert.notEqual(makeMemo({ titleSource: 'default' }).titleSource, 'user');
    assert.notEqual(makeMemo({ titleSource: 'location', title: 'Home' }).titleSource, 'user');
  });
});
