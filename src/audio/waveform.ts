import { decodeAudioData } from 'react-native-audio-api';

const DEFAULT_PEAK_COUNT = 150;

export async function computeWaveformPeaks(
  filePath: string,
  peakCount = DEFAULT_PEAK_COUNT
): Promise<number[]> {
  const buffer = await decodeAudioData(filePath);
  const channelData = buffer.getChannelData(0);
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / peakCount));
  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      max = Math.max(max, Math.abs(channelData[j]));
    }
    peaks.push(max);
  }

  const highest = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / highest);
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
  capturedPeaks?: number[]
): Promise<number[] | undefined> {
  if (capturedPeaks && capturedPeaks.length > 0) {
    return resamplePeaks(capturedPeaks);
  }

  try {
    return await computeWaveformPeaks(filePath);
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
