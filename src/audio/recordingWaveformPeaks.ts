const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 1;
const WAVEFORM_PIXELS_PER_SECOND = 48;
const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;

export function getBarIndexForTime(timeSec: number): number {
  return Math.floor(timeSec * WAVEFORM_PIXELS_PER_SECOND / BAR_STEP);
}

export function accumulatePeaksFromSamples(
  channelData: ArrayLike<number>,
  bufferStartSec: number,
  sampleRate: number,
  existingPeaks: number[]
): number[] {
  if (channelData.length === 0 || sampleRate <= 0) {
    return existingPeaks;
  }

  // Mutate in place — the engine owns this buffer for the recording session.
  const peaks = existingPeaks;

  for (let i = 0; i < channelData.length; i++) {
    const sampleTime = bufferStartSec + i / sampleRate;
    const barIndex = Math.floor(sampleTime * WAVEFORM_PIXELS_PER_SECOND / BAR_STEP);
    if (barIndex < 0) {
      continue;
    }

    const samplePeak = Math.abs(channelData[i] ?? 0);
    while (peaks.length <= barIndex) {
      peaks.push(0);
    }
    peaks[barIndex] = Math.max(peaks[barIndex] ?? 0, samplePeak);
  }

  return peaks;
}
