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
