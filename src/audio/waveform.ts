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

/**
 * One output sample of a full-array resample — same upsample / max-in-bucket
 * downsample rules as `resamplePeaks`, without allocating the full result.
 * Used by the timeline paint path so zoom only samples visible bars.
 */
export function resamplePeakAt(
  peaks: number[],
  peakCount: number,
  index: number
): number {
  if (peaks.length === 0 || peakCount <= 0 || index < 0 || index >= peakCount) {
    return 0;
  }
  if (peaks.length === peakCount) {
    return peaks[index] ?? 0;
  }
  if (peaks.length < peakCount) {
    const sourceIndex = Math.floor((index / peakCount) * peaks.length);
    return peaks[sourceIndex] ?? peaks[peaks.length - 1] ?? 0;
  }

  const bucketSize = peaks.length / peakCount;
  const start = Math.floor(index * bucketSize);
  const end = Math.floor((index + 1) * bucketSize);
  let max = 0;
  for (let j = start; j < end; j++) {
    max = Math.max(max, peaks[j] ?? 0);
  }
  return max;
}

export function resamplePeaks(peaks: number[], peakCount = DEFAULT_PEAK_COUNT): number[] {
  if (peaks.length === 0) {
    return [];
  }
  if (peaks.length === peakCount) {
    return peaks;
  }
  const next: number[] = [];
  for (let i = 0; i < peakCount; i++) {
    next.push(resamplePeakAt(peaks, peakCount, i));
  }
  return next;
}

/** Build design-density peaks from a live capture without decoding the file. */
export function waveformPeaksFromCaptured(
  capturedPeaks: number[] | undefined,
  duration: number
): number[] | undefined {
  if (!shouldUseCapturedPeaks(capturedPeaks, duration)) {
    return undefined;
  }
  const peakCount = peakCountForDuration(duration);
  return resamplePeaks(capturedPeaks!.map(peakToAbsoluteScale), peakCount);
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

/** Single-bar variant of `normalizePeaksForBarCount` for viewport-scoped paint. */
export function normalizePeakAt(
  peaks: number[] | undefined,
  barCount: number,
  index: number
): number {
  if (barCount <= 0) {
    return 0;
  }
  // Avoid allocating a full placeholder array per bar when peaks are missing.
  if (!peaks || peaks.length === 0) {
    return 0.05;
  }
  return resamplePeakAt(peaks, barCount, index);
}

/**
 * Map a bar index within a looped footprint to an index in a one-cycle peak array.
 * Uses fractional `barsPerCycle` so later cycles do not drift when that value is
 * non-integer (common at list-row density where `floor(barsPerCycle)` truncates).
 */
export function loopPeakIndex(
  barIndex: number,
  barsPerCycle: number,
  cycleBarCount: number
): number {
  if (cycleBarCount <= 0) {
    return 0;
  }
  if (!(barsPerCycle > 0) || !Number.isFinite(barsPerCycle)) {
    return Math.min(cycleBarCount - 1, Math.max(0, Math.floor(barIndex)));
  }
  const phasePos = ((barIndex % barsPerCycle) + barsPerCycle) % barsPerCycle;
  const phase = phasePos / barsPerCycle;
  return Math.min(cycleBarCount - 1, Math.floor(phase * cycleBarCount));
}

/** Float bar count spanning one loop cycle at the given pixels-per-second. */
export function barsPerCycleAtPps(
  cycleDuration: number,
  pixelsPerSecond: number,
  barStep: number = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP
): number {
  if (!(cycleDuration > 0) || !(pixelsPerSecond > 0) || !(barStep > 0)) {
    return 0;
  }
  return (cycleDuration * pixelsPerSecond) / barStep;
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

  const barStep = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
  const safeTrimIn = Math.max(0, Math.min(trimIn, duration));
  const safeTrimOut = Math.max(safeTrimIn, Math.min(trimOut, duration));
  const designCount = peakCountForDuration(duration);
  const denseEnough =
    peaks.length >= Math.max(1, Math.floor(designCount * CAPTURED_PEAKS_MIN_DENSITY));

  let startIndex: number;
  let endIndex: number;
  if (denseEnough) {
    // Design-density bars (~16/s) — same mapping as live latency preview.
    // Proportional floor() under-sliced (e.g. 0.17s → 2 bars / 125ms) and left a
    // quiet lead gap that pushed accents late vs the metronome grid.
    startIndex = Math.max(
      0,
      Math.round((safeTrimIn * WAVEFORM_PIXELS_PER_SECOND) / barStep)
    );
    endIndex = Math.min(
      peaks.length,
      Math.max(
        startIndex + 1,
        Math.round((safeTrimOut * WAVEFORM_PIXELS_PER_SECOND) / barStep)
      )
    );
  } else {
    startIndex = Math.max(0, Math.round((safeTrimIn / duration) * peaks.length));
    endIndex = Math.min(
      peaks.length,
      Math.max(startIndex + 1, Math.round((safeTrimOut / duration) * peaks.length))
    );
  }
  return peaks.slice(startIndex, endIndex);
}
