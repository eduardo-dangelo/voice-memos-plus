export const WAVEFORM_BAR_WIDTH = 2;
export const WAVEFORM_BAR_GAP = 1;
export const WAVEFORM_PIXELS_PER_SECOND = 48;
export const WAVEFORM_ABSOLUTE_PEAK_MAX = 1;

const DEFAULT_PEAK_COUNT = 150;

/**
 * capturedPeaks must describe the ENTIRE file at design density (~16 bars/s).
 * Reject clearly under-dense captures (e.g. a replace segment stretched over a
 * full layer) so we decode the file instead of upsampling sparse bars.
 */
export const CAPTURED_PEAKS_MIN_DENSITY = 0.5;

export function peakToAbsoluteScale(peak: number): number {
  return Math.max(0, Math.min(1, peak / WAVEFORM_ABSOLUTE_PEAK_MAX));
}

export function peakCountForDuration(duration: number): number {
  const barStep = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
  return Math.max(1, Math.floor(duration * WAVEFORM_PIXELS_PER_SECOND / barStep));
}

/** True when capturedPeaks look dense enough to represent the full file duration. */
export function shouldUseCapturedPeaks(
  capturedPeaks: number[] | undefined,
  duration?: number
): boolean {
  if (!capturedPeaks || capturedPeaks.length === 0) {
    return false;
  }
  if (duration == null || !(duration > 0)) {
    return true;
  }
  const expected = peakCountForDuration(duration);
  return capturedPeaks.length >= expected * CAPTURED_PEAKS_MIN_DENSITY;
}

export { accumulatePeaksFromSamples, getBarIndexForTime } from './recordingWaveformPeaks';

export function computeWaveformPeaksFromChannelData(
  channelData: ArrayLike<number>,
  peakCount = DEFAULT_PEAK_COUNT
): number[] {
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / peakCount));
  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      max = Math.max(max, Math.abs(channelData[j] ?? 0));
    }
    peaks.push(peakToAbsoluteScale(max));
  }

  return peaks;
}

export async function computeWaveformPeaks(
  filePath: string,
  peakCount = DEFAULT_PEAK_COUNT
): Promise<number[]> {
  const { decodeAudioData } = await import('react-native-audio-api');
  const buffer = await decodeAudioData(filePath);
  return computeWaveformPeaksFromChannelData(buffer.getChannelData(0), peakCount);
}

export function resamplePeaks(peaks: number[], peakCount = DEFAULT_PEAK_COUNT): number[] {
  if (peaks.length === 0) {
    return [];
  }
  if (peaks.length === peakCount) {
    return peaks;
  }
  if (peaks.length < peakCount) {
    const next: number[] = [];
    for (let i = 0; i < peakCount; i++) {
      const sourceIndex = Math.floor((i / peakCount) * peaks.length);
      next.push(peaks[sourceIndex] ?? peaks[peaks.length - 1] ?? 0);
    }
    return next;
  }

  const bucketSize = peaks.length / peakCount;
  const next: number[] = [];
  for (let i = 0; i < peakCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let max = 0;
    for (let j = start; j < end; j++) {
      max = Math.max(max, peaks[j] ?? 0);
    }
    next.push(max);
  }
  return next;
}

export async function resolveWaveformPeaks(
  filePath: string,
  duration?: number,
  capturedPeaks?: number[],
  decodedChannelData?: ArrayLike<number>
): Promise<number[] | undefined> {
  // Prefer live peaks only when they span the full file at design density.
  if (shouldUseCapturedPeaks(capturedPeaks, duration)) {
    const peakCount = duration ? peakCountForDuration(duration) : capturedPeaks!.length;
    return resamplePeaks(capturedPeaks!.map(peakToAbsoluteScale), peakCount);
  }

  try {
    const peakCount = duration ? peakCountForDuration(duration) : DEFAULT_PEAK_COUNT;
    if (decodedChannelData) {
      return computeWaveformPeaksFromChannelData(decodedChannelData, peakCount);
    }
    return await computeWaveformPeaks(filePath, peakCount);
  } catch {
    return undefined;
  }
}

export function getPeaksForMemo(memoPeaks: number[] | undefined, fallbackCount = 100): number[] {
  if (memoPeaks && memoPeaks.length > 0) {
    return memoPeaks;
  }
  return Array.from({ length: fallbackCount }, () => 0.05);
}

/** Resample the full peak array to barCount — never slice first (that crops zoom-out). */
export function normalizePeaksForBarCount(
  peaks: number[] | undefined,
  barCount: number
): number[] {
  if (barCount <= 0) {
    return [];
  }
  return resamplePeaks(getPeaksForMemo(peaks, barCount), barCount);
}

export function slicePeaksForTrim(
  peaks: number[] | undefined,
  duration: number,
  trimIn: number,
  trimOut: number
): number[] | undefined {
  if (!peaks || peaks.length === 0 || duration <= 0) {
    return peaks;
  }

  const startIndex = Math.floor((trimIn / duration) * peaks.length);
  const endIndex = Math.max(startIndex + 1, Math.ceil((trimOut / duration) * peaks.length));
  return peaks.slice(startIndex, endIndex);
}
