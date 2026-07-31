import type { Memo } from '@/src/storage/types';

type MemoUpdateListener = (memo: Memo) => void;

export type LibraryChangeEvent = {
  reason: string;
  memoId?: string;
};

type LibraryChangeListener = (event: LibraryChangeEvent) => void;

const memoUpdateListeners = new Set<MemoUpdateListener>();
const libraryChangeListeners = new Set<LibraryChangeListener>();

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

export function subscribeLibraryChanged(listener: LibraryChangeListener): () => void {
  libraryChangeListeners.add(listener);
  return () => {
    libraryChangeListeners.delete(listener);
  };
}

export function notifyLibraryChanged(event: LibraryChangeEvent): void {
  for (const listener of libraryChangeListeners) {
    listener(event);
  }
}
