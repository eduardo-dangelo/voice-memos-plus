import type { Memo } from '@/src/storage/types';

type MemoUpdateListener = (memo: Memo) => void;

const memoUpdateListeners = new Set<MemoUpdateListener>();

export function subscribeMemoUpdate(listener: MemoUpdateListener): () => void {
  memoUpdateListeners.add(listener);
  return () => {
    memoUpdateListeners.delete(listener);
  };
}

export function notifyMemoUpdate(memo: Memo): void {
  for (const listener of memoUpdateListeners) {
    listener(memo);
  }
}
