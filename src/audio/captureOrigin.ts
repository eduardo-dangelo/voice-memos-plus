const SESSION_RELATIVE_WHEN_MAX_SEC = 0.25;
const ORIGIN_CALIBRATE_SEC = 0.5;

export type CaptureOriginUpdateInput = {
  previousOrigin: number;
  contextTimeAtDelivery: number;
  framesDeliveredIncludingThis: number;
  bufferFrameCount: number;
  sampleRate: number;
  /** Recorder `when` — session-relative on 0.12; may be AudioContext time on 0.13+. */
  eventWhen?: number;
};

/**
 * Estimate AudioContext time of capture sample 0.
 * Back-extrapolates from buffer delivery (one-sided: late, never early) for the
 * first ~0.5 s. Uses native `when` only when it looks like a context timestamp.
 */
export function updateCaptureOriginFromBuffer(
  input: CaptureOriginUpdateInput
): number {
  const sampleRate = input.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
    return input.previousOrigin;
  }

  const deliveredSec = input.framesDeliveredIncludingThis / sampleRate;
  const backExtrapolated = input.contextTimeAtDelivery - deliveredSec;

  let origin = input.previousOrigin;
  if (!(origin > 0) || !Number.isFinite(origin)) {
    origin = backExtrapolated;
  } else if (deliveredSec <= ORIGIN_CALIBRATE_SEC) {
    origin = Math.min(origin, backExtrapolated);
  }

  const eventWhen = input.eventWhen;
  if (
    typeof eventWhen === 'number' &&
    Number.isFinite(eventWhen) &&
    eventWhen > SESSION_RELATIVE_WHEN_MAX_SEC
  ) {
    const framesBefore = Math.max(
      0,
      input.framesDeliveredIncludingThis - Math.max(0, input.bufferFrameCount)
    );
    const originFromWhen = eventWhen - framesBefore / sampleRate;
    if (Math.abs(originFromWhen - backExtrapolated) < ORIGIN_CALIBRATE_SEC) {
      origin = originFromWhen;
    }
  }

  return origin;
}

/** Cue origin minus capture sample-0 on the AudioContext clock. */
export function measuredCueLeadFromOrigin(
  cueWhen: number,
  captureOrigin: number,
  recorderStartWhen: number
): number {
  const origin =
    captureOrigin > 0 && Number.isFinite(captureOrigin)
      ? captureOrigin
      : recorderStartWhen;
  if (!(cueWhen > 0) || !(origin > 0)) {
    return 0;
  }
  return Math.max(0, cueWhen - origin);
}
