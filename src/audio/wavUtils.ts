import { File } from 'expo-file-system';
import {
  AudioContext,
  AudioBuffer,
  concatAudioFiles,
  decodeAudioData,
} from 'react-native-audio-api';

function writeWavFromBuffer(buffer: AudioBuffer, outputPath: string): void {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
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
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = buffer.getChannelData(channel)[frame];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped * 0x7fff, true);
      offset += 2;
    }
  }

  const file = new File(outputPath);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);
}

async function extractSegmentToWav(
  filePath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  const buffer = await decodeAudioData(filePath);
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.floor(endSec * sampleRate);
  const length = Math.max(1, endSample - startSample);
  const context = new AudioContext({ sampleRate });
  const slice = context.createBuffer(buffer.numberOfChannels, length, sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const destination = new Float32Array(length);
    destination.set(source.subarray(startSample, startSample + length));
    slice.copyToChannel(destination, channel);
  }

  writeWavFromBuffer(slice, outputPath);
  await context.close();
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
    const buffer = await decodeAudioData(layer.path);
    const layerData = buffer.getChannelData(0);
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
