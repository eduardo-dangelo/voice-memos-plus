import type { Memo } from '@/src/storage/types';

/** Next stack order — always above existing tracks (survives deletes with gaps). */
export function nextLayerOrder(memo: Memo): number {
  return memo.layers.reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
}
