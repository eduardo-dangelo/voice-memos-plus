import { File, Paths } from 'expo-file-system';
import {
  AudioBuffer,
  AudioContext,
  concatAudioFiles,
  decodeAudioData,
} from 'react-native-audio-api';

import { randomId } from '@/src/utils/id';

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

function writeWavFromDecodedSlice(
  buffer: AudioBuffer,
  startSample: number,
  length: number,
  outputPath: string
): void {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = Math.round(buffer.sampleRate);
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = length * blockAlign;
  const padByte = dataSize % 2;
  const headerSize = 44;
  const totalSize = headerSize + dataSize + padByte;
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
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  if (numChannels === 1) {
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const sample = channelData[startSample + i];
      const clamped = sample <= -1 ? -32768 : sample >= 1 ? 32767 : (sample * 0x7fff) | 0;
      view.setInt16(offset, clamped, true);
      offset += 2;
    }
  } else {
    for (let frame = 0; frame < length; frame += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        const sample = buffer.getChannelData(channel)[startSample + frame];
        const clamped = sample <= -1 ? -32768 : sample >= 1 ? 32767 : (sample * 0x7fff) | 0;
        view.setInt16(offset, clamped, true);
        offset += 2;
      }
    }
  }

  const file = new File(outputPath);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  const writtenSize = file.info().size ?? 0;
  if (writtenSize < headerSize + 1) {
    throw new Error('Failed to write trimmed audio segment');
  }
}

async function normalizeWavForExport(inputWavPath: string, outputWavPath: string): Promise<void> {
  const outputFile = new File(outputWavPath);
  if (outputFile.exists) {
    outputFile.delete();
  }
  await concatAudioFiles([inputWavPath], outputWavPath);
}

function writeWavFromBuffer(buffer: AudioBuffer, outputPath: string): void {
  writeWavFromDecodedSlice(buffer, 0, buffer.length, outputPath);
}

async function extractSegmentToWav(
  filePath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  const buffer = await decodeAudioData(filePath);
  const { startSample, length } = getTrimSampleRange(buffer, startSec, endSec);
  writeWavFromDecodedSlice(buffer, startSample, length, outputPath);
}

export async function trimAudioFile(
  inputPath: string,
  trimIn: number,
  trimOut: number,
  outputPath: string
): Promise<void> {
  const buffer = await decodeAudioData(inputPath);
  const { startSample, length } = getTrimSampleRange(buffer, trimIn, trimOut);

  const tempWav = new File(Paths.cache, `trim-segment-${randomId()}.wav`);
  if (tempWav.exists) {
    tempWav.delete();
  }

  writeWavFromDecodedSlice(buffer, startSample, length, tempWav.uri);

  const normalizedWav = new File(Paths.cache, `trim-normalized-${randomId()}.wav`);
  if (normalizedWav.exists) {
    normalizedWav.delete();
  }

  await normalizeWavForExport(tempWav.uri, normalizedWav.uri);

  const outputFile = new File(outputPath);
  if (outputFile.exists) {
    outputFile.delete();
  }

  await normalizedWav.copy(outputFile);

  if (tempWav.exists) {
    tempWav.delete();
  }
  if (normalizedWav.exists) {
    normalizedWav.delete();
  }
}

export async function spliceRecording(
  originalPath: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  outputPath: string
): Promise<number> {
  const original = await decodeAudioData(originalPath);
  const duration = original.duration;
  const segments: string[] = [];
  const tempBefore = `${originalPath}.before.wav`;
  const tempAfter = `${originalPath}.after.wav`;

  if (trimStart > 0.05) {
    await extractSegmentToWav(originalPath, 0, trimStart, tempBefore);
    segments.push(tempBefore);
  }

  segments.push(replacementPath);

  if (trimEnd < duration - 0.05) {
    await extractSegmentToWav(originalPath, trimEnd, duration, tempAfter);
    segments.push(tempAfter);
  }

  const outputFile = new File(outputPath);
  if (outputFile.exists) {
    outputFile.delete();
  }

  await concatAudioFiles(segments, outputPath);

  for (const tempPath of [tempBefore, tempAfter]) {
    const temp = new File(tempPath);
    if (temp.exists) {
      temp.delete();
    }
  }

  const result = await decodeAudioData(outputPath);
  return result.duration;
}

export type MixLayerInput = {
  path: string;
  startTime: number;
};

export async function mixLayersToFile(
  layers: MixLayerInput[],
  timelineDuration: number,
  outputPath: string
): Promise<void> {
  if (layers.length === 0) {
    throw new Error('No layers to mix');
  }

  const sampleRate = 44100;
  const numFrames = Math.max(1, Math.ceil(timelineDuration * sampleRate));
  const context = new AudioContext({ sampleRate });
  const master = context.createBuffer(1, numFrames, sampleRate);
  const masterData = master.getChannelData(0);

  for (const layer of layers) {
    const layerBuffer = await decodeAudioData(layer.path);
    const layerData = layerBuffer.getChannelData(0);
    const startSample = Math.floor(layer.startTime * sampleRate);

    for (let i = 0; i < layerData.length; i += 1) {
      const targetIndex = startSample + i;
      if (targetIndex >= numFrames) {
        break;
      }
      const mixed = masterData[targetIndex] + layerData[i];
      masterData[targetIndex] = Math.max(-1, Math.min(1, mixed));
    }
  }

  const tempWav = `${outputPath}.mix.wav`;
  writeWavFromBuffer(master, tempWav);
  await context.close();

  const outputFile = new File(outputPath);
  if (outputFile.exists) {
    outputFile.delete();
  }

  await concatAudioFiles([tempWav], outputPath);

  const temp = new File(tempWav);
  if (temp.exists) {
    temp.delete();
  }
}
