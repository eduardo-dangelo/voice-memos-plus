/** How far ahead to schedule metronome clicks while recording (sliding window). */
export const METRONOME_RECORDING_CHUNK_SEC = 12;

/** Start extending the next chunk when within this many seconds of the horizon. */
export const METRONOME_RECORDING_EXTEND_LEAD_SEC = 2;

/** Interval for the dedicated recording metronome extend timer (matches preview). */
export const METRONOME_RECORDING_EXTEND_INTERVAL_MS = 2000;

/** During recording, metronome must not be capped at memo playback end. */
export function shouldCapMetronomeScheduleAtPlaybackEnd(isRecording: boolean): boolean {
  return !isRecording;
}

export function computeMetronomeScheduleTo(
  scheduleFrom: number,
  timelineNow: number,
  chunkSec: number,
  playbackEndAt: number,
  isRecording: boolean
): number {
  let scheduleTo = Math.max(scheduleFrom, timelineNow) + chunkSec;
  if (shouldCapMetronomeScheduleAtPlaybackEnd(isRecording) && playbackEndAt > 0) {
    scheduleTo = Math.min(scheduleTo, playbackEndAt);
  }
  return scheduleTo;
}

export function canExtendMetronomeSchedule(
  scheduleFrom: number,
  scheduleTo: number
): boolean {
  return scheduleTo > scheduleFrom + 0.001;
}

export function shouldExtendMetronomeSchedule(
  timelineNow: number,
  scheduledUntil: number,
  extendLeadSec: number
): boolean {
  return timelineNow >= scheduledUntil - extendLeadSec;
}

/** Timeline position for metronome extension — no upper clamp at playbackEndAt. */
export function getUnclampedRecordingTimelineNow(
  playbackStartAt: number,
  playbackContextStartWhen: number,
  playbackRateAnchorContextTime: number,
  playbackRateAnchorPosition: number,
  playbackRate: number,
  contextCurrentTime: number,
  recorderDuration: number
): number {
  if (playbackContextStartWhen > 0) {
    let pos: number;
    if (playbackRateAnchorContextTime > 0) {
      const dt = contextCurrentTime - playbackRateAnchorContextTime;
      pos = playbackRateAnchorPosition + dt * playbackRate;
    } else {
      const elapsed = contextCurrentTime - playbackContextStartWhen;
      pos = playbackStartAt + elapsed * playbackRate;
    }
    return Math.max(playbackStartAt, pos);
  }
  return playbackStartAt + recorderDuration;
}
