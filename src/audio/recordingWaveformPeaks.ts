const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 1;
const WAVEFORM_PIXELS_PER_SECOND = 48;
const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;

export function getBarIndexForTime(timeSec: number): number {
  return Math.floor((timeSec * WAVEFORM_PIXELS_PER_SECOND) / BAR_STEP);
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
  const lastSampleTime = bufferStartSec + (channelData.length - 1) / sampleRate;
  const startBar = Math.max(0, getBarIndexForTime(bufferStartSec));
  const endBar = Math.max(0, getBarIndexForTime(lastSampleTime));

  while (peaks.length <= endBar) {
    peaks.push(0);
  }

  for (let barIndex = startBar; barIndex <= endBar; barIndex++) {
    const barStartSec = (barIndex * BAR_STEP) / WAVEFORM_PIXELS_PER_SECOND;
    const barEndSec = ((barIndex + 1) * BAR_STEP) / WAVEFORM_PIXELS_PER_SECOND;
    const sampleStart = Math.max(
      0,
      Math.floor((barStartSec - bufferStartSec) * sampleRate)
    );
    const sampleEnd = Math.min(
      channelData.length,
      Math.floor((barEndSec - bufferStartSec) * sampleRate)
    );
    let max = peaks[barIndex] ?? 0;
    for (let i = sampleStart; i < sampleEnd; i++) {
      const samplePeak = Math.abs(channelData[i] ?? 0);
      if (samplePeak > max) {
        max = samplePeak;
      }
    }
    peaks[barIndex] = max;
  }

  return peaks;
}
