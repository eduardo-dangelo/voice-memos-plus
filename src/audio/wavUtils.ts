import { File, Paths } from 'expo-file-system';
import {
    AudioBuffer,
    AudioContext,
    decodeAudioData,
} from 'react-native-audio-api';

import { randomId } from '@/src/utils/id';
import {
  computeNormalizeFromRate,
  recordingNeedsNormalize,
  TARGET_SAMPLE_RATE,
} from '@/src/audio/normalizeRecordingLogic';
import {
  applySpliceEdgeFades,
} from '@/src/audio/spliceEdgeFades';

export {
  computeNormalizeFromRate,
  recordingNeedsNormalize,
  TARGET_SAMPLE_RATE,
} from '@/src/audio/normalizeRecordingLogic';

export {
  applySpliceEdgeFades,
  SPLICE_EDGE_FADE_SECONDS,
} from '@/src/audio/spliceEdgeFades';

function getTrimSampleRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): { startSample: number; length: number; sampleRate: number } {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.min(
    Math.floor(startSec * sampleRate),
    Math.max(0, buffer.length - 1)
  );
  const endSample = Math.min(Math.floor(endSec * sampleRate), buffer.length);
  const length = Math.max(1, endSample - startSample);
  return { startSample, length, sampleRate };
}

function floatToPcm16(sample: number): number {
  return sample <= -1 ? -32768 : sample >= 1 ? 32767 : (sample * 0x7fff) | 0;
}

function writePcm16WavHeader(
  bytes: Uint8Array,
  view: DataView,
  sampleRate: number,
  numChannels: number,
  frameCount: number
): void {
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = frameCount * blockAlign;
  const totalSize = 44 + dataSize;

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      bytes[offset + i] = value.charCodeAt(i);
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
}

function writeWavBytesToFile(bytes: Uint8Array, outputPath: string): void {
  const file = new File(outputPath);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  const writtenSize = file.info().size ?? 0;
  if (writtenSize !== bytes.byteLength) {
    throw new Error(
      `Failed to write WAV file: expected ${bytes.byteLength} bytes, wrote ${writtenSize}`
    );
  }
}

export function writeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate: number,
  outputPath: string
): void {
  const sr = Math.round(sampleRate);
  const length = samples.length;
  const totalSize = 44 + length * 2;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  writePcm16WavHeader(bytes, view, sr, 1, length);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    view.setInt16(offset, floatToPcm16(samples[i]), true);
    offset += 2;
  }

  writeWavBytesToFile(bytes, outputPath);
}

export function writeStereoPcm16Wav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  outputPath: string
): void {
  const sr = Math.round(sampleRate);
  const length = Math.min(left.length, right.length);
  const totalSize = 44 + length * 4;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  writePcm16WavHeader(bytes, view, sr, 2, length);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    view.setInt16(offset, floatToPcm16(left[i]), true);
    offset += 2;
    view.setInt16(offset, floatToPcm16(right[i]), true);
    offset += 2;
  }

  writeWavBytesToFile(bytes, outputPath);
}

function isWavPath(path: string): boolean {
  return path.toLowerCase().endsWith('.wav');
}

async function exportMonoSamplesToPath(
  samples: Float32Array,
  sampleRate: number,
  outputPath: string
): Promise<number> {
  const outputIsWav = isWavPath(outputPath);
  const tempWav = outputIsWav
    ? new File(outputPath)
    : new File(Paths.cache, `export-segment-${randomId()}.wav`);
  if (tempWav.exists) {
    tempWav.delete();
  }

  writeMonoPcm16Wav(samples, sampleRate, tempWav.uri);

  const preflight = await decodeAudioData(tempWav.uri);

  if (outputIsWav) {
    return preflight.duration;
  }

  const outputFile = new File(outputPath);
  if (outputFile.exists) {
    outputFile.delete();
  }
  await tempWav.copy(outputFile);

  const outputSize = outputFile.info().size ?? 0;
  const expectedOutputSize = 44 + samples.length * 2;
  if (outputSize !== expectedOutputSize) {
    throw new Error(
      `Failed to copy WAV to output: expected ${expectedOutputSize} bytes, got ${outputSize}`
    );
  }

  if (tempWav.exists && tempWav.uri !== outputPath) {
    tempWav.delete();
  }

  return preflight.duration;
}

export function resampleMonoBufferFromRate(
  buffer: AudioBuffer,
  fromRate: number,
  targetRate: number,
  context: AudioContext
): AudioBuffer {
  const roundedFrom = Math.round(fromRate);
  const roundedTarget = Math.round(targetRate);
  if (roundedFrom === roundedTarget) {
    return buffer;
  }

  const resampled = resampleChannelData(
    buffer.getChannelData(0),
    roundedFrom,
    roundedTarget
  );
  const out = context.createBuffer(1, resampled.length, roundedTarget);
  out.copyToChannel(resampled, 0);
  return out;
}

/**
 * Same as `resampleMonoBufferFromRate`, but yields periodically so stack
 * monitor-mix warmup does not freeze the JS thread on long layers.
 */
export async function resampleMonoBufferFromRateAsync(
  buffer: AudioBuffer,
  fromRate: number,
  targetRate: number,
  context: AudioContext
): Promise<AudioBuffer> {
  const roundedFrom = Math.round(fromRate);
  const roundedTarget = Math.round(targetRate);
  if (roundedFrom === roundedTarget) {
    return buffer;
  }

  const resampled = await resampleChannelDataAsync(
    buffer.getChannelData(0),
    roundedFrom,
    roundedTarget
  );
  const out = context.createBuffer(1, resampled.length, roundedTarget);
  out.copyToChannel(resampled, 0);
  return out;
}

export type NormalizeRecordingOptions = {
  recordedDuration?: number;
};

export type NormalizeRecordingResult = {
  path: string;
  duration: number;
  fromRateUsed: number;
  fileRate: number;
  bufferLength: number;
  skipped: boolean;
};

export async function normalizeRecordingFile(
  inputPath: string,
  targetSampleRate = TARGET_SAMPLE_RATE,
  options?: NormalizeRecordingOptions
): Promise<NormalizeRecordingResult> {
  const target = Math.round(targetSampleRate);
  const buffer = await decodeAudioData(inputPath);
  const fileRate = Math.round(buffer.sampleRate);
  const samples = buffer.getChannelData(0);

  const { fromRate, shouldResample } = computeNormalizeFromRate(
    fileRate,
    buffer.duration,
    options?.recordedDuration,
    target
  );

  if (!shouldResample) {
    return {
      path: inputPath,
      duration: buffer.duration,
      fromRateUsed: fromRate,
      fileRate,
      bufferLength: samples.length,
      skipped: true,
    };
  }

  // Yield during long resamples so stop/save does not freeze the JS thread.
  const resampledSamples = await resampleChannelDataAsync(samples, fromRate, target);

  const outputPath = isWavPath(inputPath)
    ? inputPath
    : inputPath.replace(/\.m4a$/i, '.wav');

  const duration = await exportMonoSamplesToPath(
    resampledSamples,
    target,
    outputPath
  );

  if (outputPath !== inputPath) {
    const inputFile = new File(inputPath);
    if (inputFile.exists) {
      inputFile.delete();
    }
  }

  return {
    path: outputPath,
    duration,
    fromRateUsed: fromRate,
    fileRate,
    bufferLength: samples.length,
    skipped: false,
  };
}

/** Yield about once per second of output audio during async resample. */
const RESAMPLE_YIELD_OUTPUT_SAMPLES = 48000;

function resampleChannelData(
  data: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) {
    return data;
  }

  const outLength = Math.max(1, Math.round((data.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = (i * fromRate) / toRate;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const a = data[idx] ?? 0;
    const b = data[Math.min(idx + 1, data.length - 1)] ?? 0;
    out[i] = a + frac * (b - a);
  }
  return out;
}

async function resampleChannelDataAsync(
  data: Float32Array,
  fromRate: number,
  toRate: number
): Promise<Float32Array> {
  if (fromRate === toRate) {
    return data;
  }

  const outLength = Math.max(1, Math.round((data.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = (i * fromRate) / toRate;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const a = data[idx] ?? 0;
    const b = data[Math.min(idx + 1, data.length - 1)] ?? 0;
    out[i] = a + frac * (b - a);
    if (i > 0 && i % RESAMPLE_YIELD_OUTPUT_SAMPLES === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return out;
}

function sliceBufferChannel(buffer: AudioBuffer, startSec: number, endSec: number): Float32Array {
  const { startSample, length } = getTrimSampleRange(buffer, startSec, endSec);
  return buffer.getChannelData(0).slice(startSample, startSample + length);
}

function concatFloat32Parts(parts: Float32Array[]): Float32Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(Math.max(1, totalLength));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function deleteLegacySpliceSidecars(originalPath: string): void {
  for (const suffix of ['.before.wav', '.after.wav']) {
    const legacy = new File(`${originalPath}${suffix}`);
    if (legacy.exists) {
      legacy.delete();
    }
  }
}

export type SpliceRecordingResult = {
  duration: number;
  sampleRate: number;
  samples: Float32Array;
};

export async function spliceRecording(
  originalPath: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  outputPath: string,
  options?: { leadingPadSeconds?: number; replacementSkipSeconds?: number }
): Promise<SpliceRecordingResult> {
  deleteLegacySpliceSidecars(originalPath);

  const original = await decodeAudioData(originalPath);
  const replacement = await decodeAudioData(replacementPath);
  const duration = original.duration;
  const clampedTrimStart = Math.max(0, Math.min(trimStart, duration));
  const clampedTrimEnd = Math.max(clampedTrimStart, Math.min(trimEnd, duration));
  const targetSampleRate = Math.round(original.sampleRate);
  const parts: Float32Array[] = [];

  if (clampedTrimStart > 0.05) {
    parts.push(sliceBufferChannel(original, 0, clampedTrimStart));
  }

  let replacementData = resampleChannelData(
    replacement.getChannelData(0),
    replacement.sampleRate,
    targetSampleRate
  );
  const replacementSkipSeconds = options?.replacementSkipSeconds ?? 0;
  if (replacementSkipSeconds > 0.001) {
    const skipSamples = Math.min(
      replacementData.length,
      Math.round(replacementSkipSeconds * targetSampleRate)
    );
    if (skipSamples > 0 && skipSamples < replacementData.length) {
      replacementData = replacementData.subarray(skipSamples);
    }
  }
  const leadingPadSeconds = options?.leadingPadSeconds ?? 0;
  if (leadingPadSeconds > 0.001) {
    const padSamples = Math.round(leadingPadSeconds * targetSampleRate);
    replacementData = concatFloat32Parts([new Float32Array(padSamples), replacementData]);
  }
  parts.push(replacementData);

  if (clampedTrimEnd < duration - 0.05) {
    parts.push(sliceBufferChannel(original, clampedTrimEnd, duration));
  }

  const fadedParts = applySpliceEdgeFades(parts, targetSampleRate);
  const merged = concatFloat32Parts(fadedParts);
  const writtenDuration = await exportMonoSamplesToPath(
    merged,
    targetSampleRate,
    outputPath
  );
  return {
    duration: writtenDuration,
    sampleRate: targetSampleRate,
    samples: merged,
  };
}

export function writeAudioBufferToWavFile(buffer: AudioBuffer, outputPath: string): void {
  if (buffer.numberOfChannels >= 2) {
    writeStereoPcm16Wav(
      buffer.getChannelData(0),
      buffer.getChannelData(1),
      buffer.sampleRate,
      outputPath
    );
    return;
  }
  writeMonoPcm16Wav(buffer.getChannelData(0), buffer.sampleRate, outputPath);
}

