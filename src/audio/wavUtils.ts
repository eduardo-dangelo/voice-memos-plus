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

export {
  computeNormalizeFromRate,
  recordingNeedsNormalize,
  TARGET_SAMPLE_RATE,
} from '@/src/audio/normalizeRecordingLogic';

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

export function writeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate: number,
  outputPath: string
): void {
  const sr = Math.round(sampleRate);
  const numChannels = 1;
  const length = samples.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

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
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (let i = 0; i < length; i += 1) {
    view.setInt16(offset, floatToPcm16(samples[i]), true);
    offset += 2;
  }

  const file = new File(outputPath);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  const writtenSize = file.info().size ?? 0;
  if (writtenSize !== totalSize) {
    throw new Error(
      `Failed to write WAV file: expected ${totalSize} bytes, wrote ${writtenSize}`
    );
  }
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

export async function trimAudioFile(
  inputPath: string,
  trimIn: number,
  trimOut: number,
  outputPath: string
): Promise<void> {
  const buffer = await decodeAudioData(inputPath);
  const { startSample, length, sampleRate } = getTrimSampleRange(buffer, trimIn, trimOut);
  const samples = buffer.getChannelData(0).slice(startSample, startSample + length);
  await exportMonoSamplesToPath(samples, sampleRate, outputPath);
}

export function resampleMonoBuffer(
  buffer: AudioBuffer,
  targetRate: number,
  context: AudioContext
): AudioBuffer {
  return resampleMonoBufferFromRate(
    buffer,
    buffer.sampleRate,
    targetRate,
    context
  );
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

  const resampledSamples = resampleChannelData(samples, fromRate, target);

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

export async function spliceRecording(
  originalPath: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  outputPath: string,
  options?: { leadingPadSeconds?: number }
): Promise<number> {
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
  const leadingPadSeconds = options?.leadingPadSeconds ?? 0;
  if (leadingPadSeconds > 0.001) {
    const padSamples = Math.round(leadingPadSeconds * targetSampleRate);
    replacementData = concatFloat32Parts([new Float32Array(padSamples), replacementData]);
  }
  parts.push(replacementData);

  if (clampedTrimEnd < duration - 0.05) {
    parts.push(sliceBufferChannel(original, clampedTrimEnd, duration));
  }

  const merged = concatFloat32Parts(parts);
  return exportMonoSamplesToPath(merged, targetSampleRate, outputPath);
}

export function writeAudioBufferToWavFile(buffer: AudioBuffer, outputPath: string): void {
  writeMonoPcm16Wav(buffer.getChannelData(0), buffer.sampleRate, outputPath);
}

