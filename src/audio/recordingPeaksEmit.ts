import { peakToAbsoluteScale } from '@/src/audio/waveform';

/** How many trailing bars to re-scale on growth (overlap max refresh). */
export const RECORDING_PEAKS_REFRESH_TAIL = 2;

/**
 * Build the next absolute-scaled live peaks array by appending new bars
 * (and refreshing a short trailing window) instead of remapping the full buffer.
 * Always returns a new array reference when the result differs from `previous`.
 */
export function appendAbsoluteRecordingPeaks(
  rawPeaks: number[],
  barCount: number,
  previous: number[],
  previousCount: number,
  refreshTail = RECORDING_PEAKS_REFRESH_TAIL
): { peaks: number[]; count: number } {
  const targetCount = Math.max(0, barCount);

  if (targetCount === 0) {
    return { peaks: previous.length === 0 ? previous : [], count: 0 };
  }

  if (targetCount === previousCount && previous.length === targetCount) {
    return { peaks: previous, count: previousCount };
  }

  if (targetCount < previousCount) {
    const peaks = new Array<number>(targetCount);
    for (let i = 0; i < targetCount; i++) {
      peaks[i] = peakToAbsoluteScale(rawPeaks[i] ?? 0);
    }
    return { peaks, count: targetCount };
  }

  const refreshFrom = Math.max(0, Math.min(previousCount, targetCount) - refreshTail);
  const peaks = previous.slice(0, refreshFrom);
  for (let i = refreshFrom; i < targetCount; i++) {
    peaks.push(peakToAbsoluteScale(rawPeaks[i] ?? 0));
  }
  return { peaks, count: targetCount };
}
