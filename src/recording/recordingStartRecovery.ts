/** Cooperative timeout while waiting for commitRecordingStart. */
export const COMMIT_RECORDING_TIMEOUT_MS = 8000;
/** Monitor-mix prepare + warmup must finish before this or recovery runs. */
export const PREPARE_RECORDING_TIMEOUT_MS = COMMIT_RECORDING_TIMEOUT_MS + 2000;
/** Backstop when armed chrome remains without live capture. */
export const ARMED_UI_ABORT_DELAY_MS = COMMIT_RECORDING_TIMEOUT_MS + 500;
/** After precount/prepare, fail fast if capture never latches. */
export const POST_PRECOUNT_STUCK_MS = 3000;
/** Total arming budget from first arm tap through commit (covers prepare + precount + commit). */
export const ARMING_TOTAL_TIMEOUT_MS = 15000;
/** Max time precount overlay may defer recovery during countdown. */
export const PRECOUNT_OVERLAY_MAX_MS = 15000;
/** Live capture with no progress for this long is treated as stuck. */
export const STALE_LIVE_RECORDING_MS = 5000;
export const STALE_LIVE_RECORDING_MIN_DURATION_SEC = 0.05;

export type StuckRecordingRecoveryInput = {
  isRecording: boolean;
  captureStarted: boolean;
  precountCancelled: boolean;
  precountOverlayActive: boolean;
  precountPreparing: boolean;
  precountOverlayStartedAt: number | null;
  recordingDuration: number;
  liveRecordingStartedAt: number | null;
  now: number;
};

/** Precount countdown may defer recovery only for a bounded window. */
export function isPrecountOverlayBlockingRecovery(
  input: Pick<
    StuckRecordingRecoveryInput,
    | 'precountOverlayActive'
    | 'precountPreparing'
    | 'precountOverlayStartedAt'
    | 'now'
  >
): boolean {
  if (!input.precountOverlayActive || input.precountPreparing) {
    return false;
  }
  if (input.precountOverlayStartedAt == null) {
    return true;
  }
  return input.now - input.precountOverlayStartedAt < PRECOUNT_OVERLAY_MAX_MS;
}

export function isStaleLiveRecording(
  input: Pick<
    StuckRecordingRecoveryInput,
    'isRecording' | 'recordingDuration' | 'liveRecordingStartedAt' | 'now'
  >
): boolean {
  if (!input.isRecording) {
    return false;
  }
  if (input.recordingDuration >= STALE_LIVE_RECORDING_MIN_DURATION_SEC) {
    return false;
  }
  if (input.liveRecordingStartedAt == null) {
    return false;
  }
  return input.now - input.liveRecordingStartedAt >= STALE_LIVE_RECORDING_MS;
}

/** Whether recovery may run without tearing down a healthy live take. */
export function canSafelyRecoverStuckRecordingStart(
  input: StuckRecordingRecoveryInput
): boolean {
  if (input.precountCancelled) {
    return false;
  }
  if (input.isRecording || input.captureStarted) {
    return isStaleLiveRecording(input);
  }
  if (isPrecountOverlayBlockingRecovery(input)) {
    return false;
  }
  return true;
}

export function hasArmingWatchdogExpired(
  armingStartedAt: number | null,
  now: number
): boolean {
  if (armingStartedAt == null) {
    return false;
  }
  return now - armingStartedAt >= ARMING_TOTAL_TIMEOUT_MS;
}

export function shouldRecoverStuckArming(
  input: StuckRecordingRecoveryInput & { armingStartedAt: number | null }
): boolean {
  if (!hasArmingWatchdogExpired(input.armingStartedAt, input.now)) {
    return false;
  }
  return canSafelyRecoverStuckRecordingStart(input);
}

export function rejectAfterTimeoutMs(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
