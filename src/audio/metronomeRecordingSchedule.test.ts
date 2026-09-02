import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getUnclampedRecordingTimelineNow } from './metronomeRecordingSchedule';

test('getUnclampedRecordingTimelineNow is not capped at playbackEndAt', () => {
  const clampedPlaybackEnd = 12;
  const rawPosition = 18;

  const unclamped = getUnclampedRecordingTimelineNow(
    0,
    100,
    100,
    0,
    1,
    118,
    0
  );
  assert.equal(unclamped, rawPosition);
  assert.ok(unclamped > clampedPlaybackEnd);

  const fromRecorder = getUnclampedRecordingTimelineNow(0, 0, 0, 0, 1, 0, 20);
  assert.equal(fromRecorder, 20);
});
