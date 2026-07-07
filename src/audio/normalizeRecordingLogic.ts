export const TARGET_SAMPLE_RATE = 44100;
export const NORMALIZE_DURATION_RATIO_MIN = 0.97;
export const NORMALIZE_DURATION_RATIO_MAX = 1.03;

export function computeNormalizeFromRate(
  fileRate: number,
  bufferDuration: number,
  recordedDuration: number | undefined,
  targetSampleRate = TARGET_SAMPLE_RATE
): { fromRate: number; shouldResample: boolean } {
  const target = Math.round(targetSampleRate);
  const file = Math.round(fileRate);
  let fromRate = file;

  if (
    recordedDuration !== undefined &&
    recordedDuration > 0.05 &&
    bufferDuration > 0
  ) {
    const durationRatio = bufferDuration / recordedDuration;
    if (
      durationRatio < NORMALIZE_DURATION_RATIO_MIN ||
      durationRatio > NORMALIZE_DURATION_RATIO_MAX
    ) {
      fromRate = Math.max(8000, Math.round(file * durationRatio));
    }
  }

  if (fromRate === target) {
    return { fromRate, shouldResample: false };
  }

  return { fromRate, shouldResample: true };
}

export function recordingNeedsNormalize(
  fileRate: number,
  bufferDuration: number,
  recorderDuration: number,
  targetSampleRate = TARGET_SAMPLE_RATE
): boolean {
  const target = Math.round(targetSampleRate);
  const file = Math.round(fileRate);

  if (file !== target) {
    return true;
  }

  if (recorderDuration <= 0.05 || bufferDuration <= 0) {
    return false;
  }

  const ratio = bufferDuration / recorderDuration;
  return (
    ratio < NORMALIZE_DURATION_RATIO_MIN ||
    ratio > NORMALIZE_DURATION_RATIO_MAX
  );
}
