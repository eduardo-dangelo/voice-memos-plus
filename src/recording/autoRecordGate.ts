export type AutoRecordDecision =
  | 'start'
  | 'skipNotRequested'
  | 'skipHasAudio'
  | 'skipLiveRecording'
  | 'skipNoProcessIntent'
  | 'skipDeletedMemo'
  | 'skipOtherMemoSession';

/**
 * Pure gate for FAB/auto-record after cold start.
 * Restored ?record=1 without a process-local intent must not re-arm Stop.
 */
export function decideAutoRecord(input: {
  autoRecord: boolean;
  isRecording: boolean;
  hasRecording: boolean;
  hasProcessIntent: boolean;
  sessionMemoId: string | null | undefined;
  memoId: string;
  memoMissing?: boolean;
}): AutoRecordDecision {
  if (input.memoMissing) {
    return 'skipDeletedMemo';
  }
  if (!input.autoRecord) {
    return 'skipNotRequested';
  }
  if (!input.hasProcessIntent) {
    return 'skipNoProcessIntent';
  }
  if (input.hasRecording) {
    return 'skipHasAudio';
  }
  if (input.isRecording) {
    return 'skipLiveRecording';
  }
  if (input.sessionMemoId && input.sessionMemoId !== input.memoId) {
    return 'skipOtherMemoSession';
  }
  return 'start';
}
