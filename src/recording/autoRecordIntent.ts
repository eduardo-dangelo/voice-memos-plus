/**
 * Process-local tokens for FAB / split-view auto-record.
 * After force-quit these are gone, so restored ?record=1 is ignored.
 */
const pendingAutoRecordMemoIds = new Set<string>();

export function markAutoRecordIntent(memoId: string): void {
  pendingAutoRecordMemoIds.add(memoId);
}

export function consumeAutoRecordIntent(memoId: string): boolean {
  if (!pendingAutoRecordMemoIds.has(memoId)) {
    return false;
  }
  pendingAutoRecordMemoIds.delete(memoId);
  return true;
}

export function hasAutoRecordIntent(memoId: string): boolean {
  return pendingAutoRecordMemoIds.has(memoId);
}
