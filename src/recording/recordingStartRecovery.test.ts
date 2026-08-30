import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARMING_TOTAL_TIMEOUT_MS,
  canSafelyRecoverStuckRecordingStart,
  hasArmingWatchdogExpired,
  isPrecountOverlayBlockingRecovery,
  isStaleLiveRecording,
  PRECOUNT_OVERLAY_MAX_MS,
  shouldRecoverStuckArming,
  STALE_LIVE_RECORDING_MS,
  STALE_LIVE_RECORDING_MIN_DURATION_SEC,
} from '@/src/recording/recordingStartRecovery';

const baseInput = {
  isRecording: false,
  captureStarted: false,
  precountCancelled: false,
  precountOverlayActive: false,
  precountPreparing: false,
  precountOverlayStartedAt: null as number | null,
  recordingDuration: 0,
  liveRecordingStartedAt: null as number | null,
  now: 20_000,
};

test('hasArmingWatchdogExpired is false before total timeout', () => {
  const startedAt = 10_000;
  assert.equal(hasArmingWatchdogExpired(startedAt, startedAt + ARMING_TOTAL_TIMEOUT_MS - 1), false);
  assert.equal(hasArmingWatchdogExpired(startedAt, startedAt + ARMING_TOTAL_TIMEOUT_MS), true);
});

test('shouldRecoverStuckArming after arming timeout with no capture', () => {
  const armingStartedAt = 0;
  assert.equal(
    shouldRecoverStuckArming({
      ...baseInput,
      armingStartedAt,
      now: ARMING_TOTAL_TIMEOUT_MS,
    }),
    true
  );
});

test('shouldRecoverStuckArming does not recover healthy live capture', () => {
  assert.equal(
    shouldRecoverStuckArming({
      ...baseInput,
      armingStartedAt: 0,
      now: ARMING_TOTAL_TIMEOUT_MS,
      isRecording: true,
      recordingDuration: STALE_LIVE_RECORDING_MIN_DURATION_SEC + 0.1,
      liveRecordingStartedAt: 1_000,
    }),
    false
  );
});

test('canSafelyRecoverStuckRecordingStart recovers stale live capture with zero duration', () => {
  const liveRecordingStartedAt = 0;
  assert.equal(
    canSafelyRecoverStuckRecordingStart({
      ...baseInput,
      isRecording: true,
      recordingDuration: 0,
      liveRecordingStartedAt,
      now: liveRecordingStartedAt + STALE_LIVE_RECORDING_MS,
    }),
    true
  );
});

test('isPrecountOverlayBlockingRecovery allows recovery after max overlay age', () => {
  const startedAt = 0;
  assert.equal(
    isPrecountOverlayBlockingRecovery({
      precountOverlayActive: true,
      precountPreparing: false,
      precountOverlayStartedAt: startedAt,
      now: PRECOUNT_OVERLAY_MAX_MS - 1,
    }),
    true
  );
  assert.equal(
    isPrecountOverlayBlockingRecovery({
      precountOverlayActive: true,
      precountPreparing: false,
      precountOverlayStartedAt: startedAt,
      now: PRECOUNT_OVERLAY_MAX_MS,
    }),
    false
  );
});

test('canSafelyRecoverStuckRecordingStart skips user-cancelled precount', () => {
  assert.equal(
    canSafelyRecoverStuckRecordingStart({
      ...baseInput,
      precountCancelled: true,
    }),
    false
  );
});

test('isStaleLiveRecording is false when duration progressed', () => {
  assert.equal(
    isStaleLiveRecording({
      isRecording: true,
      recordingDuration: STALE_LIVE_RECORDING_MIN_DURATION_SEC,
      liveRecordingStartedAt: 0,
      now: STALE_LIVE_RECORDING_MS + 100,
    }),
    false
  );
});
