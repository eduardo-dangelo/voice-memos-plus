import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canExtendMetronomeSchedule,
  computeMetronomeScheduleTo,
  getUnclampedRecordingTimelineNow,
  METRONOME_RECORDING_CHUNK_SEC,
  METRONOME_RECORDING_EXTEND_LEAD_SEC,
  shouldCapMetronomeScheduleAtPlaybackEnd,
  shouldExtendMetronomeSchedule,
} from './metronomeRecordingSchedule';

test('shouldCapMetronomeScheduleAtPlaybackEnd is false while recording', () => {
  assert.equal(shouldCapMetronomeScheduleAtPlaybackEnd(true), false);
  assert.equal(shouldCapMetronomeScheduleAtPlaybackEnd(false), true);
});

test('computeMetronomeScheduleTo extends past memo end during recording', () => {
  const scheduleFrom = 12;
  const timelineNow = 10;
  const memoEnd = 12;

  const whileRecording = computeMetronomeScheduleTo(
    scheduleFrom,
    timelineNow,
    METRONOME_RECORDING_CHUNK_SEC,
    memoEnd,
    true
  );
  assert.equal(whileRecording, 24);

  const duringPlayback = computeMetronomeScheduleTo(
    scheduleFrom,
    timelineNow,
    METRONOME_RECORDING_CHUNK_SEC,
    memoEnd,
    false
  );
  assert.equal(duringPlayback, memoEnd);
});

test('computeMetronomeScheduleTo first chunk from zero schedules 12 seconds', () => {
  const scheduleTo = computeMetronomeScheduleTo(
    0,
    0,
    METRONOME_RECORDING_CHUNK_SEC,
    0,
    true
  );
  assert.equal(scheduleTo, METRONOME_RECORDING_CHUNK_SEC);
});

test('repeated extension advances scheduledUntil past 12 seconds while recording', () => {
  let scheduledUntil = 0;
  for (let timelineNow = 0; timelineNow <= 15; timelineNow += 1) {
    if (
      shouldExtendMetronomeSchedule(
        timelineNow,
        scheduledUntil,
        METRONOME_RECORDING_EXTEND_LEAD_SEC
      )
    ) {
      const next = computeMetronomeScheduleTo(
        scheduledUntil,
        timelineNow,
        METRONOME_RECORDING_CHUNK_SEC,
        12,
        true
      );
      if (canExtendMetronomeSchedule(scheduledUntil, next)) {
        scheduledUntil = next;
      }
    }
  }
  assert.ok(scheduledUntil > METRONOME_RECORDING_CHUNK_SEC);
});

test('recording cap at memo end blocks extension during playback only', () => {
  let scheduledUntil = 0;
  for (let timelineNow = 0; timelineNow <= 15; timelineNow += 1) {
    if (
      shouldExtendMetronomeSchedule(
        timelineNow,
        scheduledUntil,
        METRONOME_RECORDING_EXTEND_LEAD_SEC
      )
    ) {
      const next = computeMetronomeScheduleTo(
        scheduledUntil,
        timelineNow,
        METRONOME_RECORDING_CHUNK_SEC,
        12,
        false
      );
      if (canExtendMetronomeSchedule(scheduledUntil, next)) {
        scheduledUntil = next;
      }
    }
  }
  assert.equal(scheduledUntil, 12);
});

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

test('shouldExtendMetronomeSchedule triggers within lead window', () => {
  assert.equal(shouldExtendMetronomeSchedule(10, 12, 2), true);
  assert.equal(shouldExtendMetronomeSchedule(9.9, 12, 2), false);
});
