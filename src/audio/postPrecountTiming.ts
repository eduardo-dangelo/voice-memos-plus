/** Matches MemoAudioEngine RECORDING_SCHEDULE_LEAD — arm lead before recorder.start(). */
export const POST_PRECOUNT_SCHEDULE_LEAD_SEC = 0.015;

/** Wall vs audio clock slack when deciding if Phase B planned downbeat is trustworthy. */
const CONTEXT_TRACKS_WALL_SLACK_SEC = 0.05;

export type PostPrecountTimingInput = {
  contextStart: number | null;
  live: number | null;
  startMs: number;
  beat1DeadlineMs: number;
  intervalMs: number;
  nowMs: number;
  scheduleLeadSec?: number;
};

/**
 * Map post-precount wall downbeat onto AudioContext time.
 * Only trusts the planned audio-clock downbeat when the context actually
 * advanced during wall precount; otherwise returns immediate-start timing.
 */
export function computePostPrecountContextWhen(
  input: PostPrecountTimingInput
): number | null {
  const { contextStart, live, startMs, beat1DeadlineMs, intervalMs, nowMs } =
    input;
  const scheduleLeadSec =
    input.scheduleLeadSec ?? POST_PRECOUNT_SCHEDULE_LEAD_SEC;

  if (contextStart == null || live == null) {
    return null;
  }

  const plannedContextWhen = contextStart + 4 * (intervalMs / 1000);
  const contextElapsed = live - contextStart;
  const wallElapsedSec = (nowMs - startMs) / 1000;
  const contextTrackedWall =
    contextElapsed >= wallElapsedSec - CONTEXT_TRACKS_WALL_SLACK_SEC;
  const remainingWallSec = Math.max(0, (beat1DeadlineMs - nowMs) / 1000);

  if (contextTrackedWall && plannedContextWhen > live + 0.01) {
    return plannedContextWhen;
  }

  return live + Math.max(remainingWallSec, scheduleLeadSec);
}
