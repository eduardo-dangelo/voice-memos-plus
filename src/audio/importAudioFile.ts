import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode, Paths } from 'expo-file-system';

import {
  accumulatePeaksFromSamples,
  computeWaveformPeaksFromChannelData,
  peakCountForDuration,
  peakToAbsoluteScale,
  resamplePeaks,
} from '@/src/audio/waveform';
import { readWavMonoSamplesWindow } from '@/src/audio/wavLeadingRead';
import {
  parseWavPcm16Layout,
  wavDurationSecFromFileSize,
  wavDurationSecFromLayout,
  type WavPcmLayout,
} from '@/src/audio/wavPcmLayout';
import {
  displayNameFromAudioFileName,
  downmixAudioChannelsToMono,
  downmixInterleavedPcm16ToMono,
  IMPORT_EMPTY_AUDIO_MESSAGE,
  IMPORT_FALLBACK_NAME,
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_UNREADABLE_AUDIO_MESSAGE,
  IMPORT_UNSUPPORTED_AUDIO_MESSAGE,
  isImportDecodeTooLarge,
} from '@/src/audio/importAudioFileLogic';
import { writeMonoPcm16Wav } from '@/src/audio/wavUtils';
import { PROJECT_MIME_TYPE } from '@/src/storage/memoPackage';
import { randomId } from '@/src/utils/id';

export {
  displayNameFromAudioFileName,
  downmixAudioChannelsToMono,
  downmixInterleavedPcm16ToMono,
  IMPORT_DECODE_MAX_BYTES,
  IMPORT_DISPLAY_NAME_MAX_LENGTH,
  IMPORT_EMPTY_AUDIO_MESSAGE,
  IMPORT_FALLBACK_NAME,
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_UNREADABLE_AUDIO_MESSAGE,
  IMPORT_UNSUPPORTED_AUDIO_MESSAGE,
  isImportDecodeTooLarge,
} from '@/src/audio/importAudioFileLogic';

const IMPORT_WAV_WINDOW_SEC = 16;

export type PickedAudioFile = {
  uri: string;
  name: string;
  size?: number;
};

export type ConvertedImportAudio = {
  wavPath: string;
  duration: number;
  waveformPeaks: number[];
  displayName: string;
};

export function deleteImportedTempFile(path: string | undefined): void {
  if (!path) {
    return;
  }
  try {
    const file = new File(path);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup of picker / conversion temps.
  }
}

async function pickDocument(type: string | string[]): Promise<
  { canceled: true } | ({ canceled: false } & PickedAudioFile)
> {
  const result = await DocumentPicker.getDocumentAsync({
    type,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets == null || result.assets.length === 0) {
    return { canceled: true };
  }
  const asset = result.assets[0];
  if (!asset?.uri) {
    return { canceled: true };
  }
  return {
    canceled: false,
    uri: asset.uri,
    name: asset.name || IMPORT_FALLBACK_NAME,
    ...(asset.size != null ? { size: asset.size } : {}),
  };
}

export async function pickAudioFile(): Promise<
  { canceled: true } | ({ canceled: false } & PickedAudioFile)
> {
  return pickDocument('audio/*');
}

/** List import: audio files and Voice Memos Plus `.vmp` projects. */
export async function pickImportableFile(): Promise<
  { canceled: true } | ({ canceled: false } & PickedAudioFile)
> {
  return pickDocument(['audio/*', PROJECT_MIME_TYPE]);
}

export async function convertPickedAudioToMonoWav(
  picked: PickedAudioFile
): Promise<ConvertedImportAudio> {
  const displayName = displayNameFromAudioFileName(picked.name);
  const dest = new File(Paths.cache, `import-${randomId()}.wav`);
  if (dest.exists) {
    dest.delete();
  }

  try {
    const layout = probePcm16Wav(picked.uri);
    if (layout) {
      if (layout.channels === 1) {
        return await copyMonoPcm16Wav(picked.uri, dest.uri, layout, displayName);
      }
      return await downmixPcm16WavToMono(picked.uri, dest.uri, layout, displayName);
    }

    if (isImportDecodeTooLarge(picked.size)) {
      throw new Error(IMPORT_TOO_LARGE_MESSAGE);
    }

    return await decodeAndWriteMonoWav(picked.uri, dest.uri, displayName);
  } catch (error) {
    deleteImportedTempFile(dest.uri);
    throw error;
  }
}

function probePcm16Wav(path: string): WavPcmLayout | null {
  try {
    const file = new File(path);
    if (!file.exists) {
      return null;
    }
    const fileSize = file.size ?? file.info().size ?? 0;
    if (fileSize < 44) {
      return null;
    }
    const probe = readFileBytesRange(file, 0, Math.min(fileSize, 64 * 1024));
    return parseWavPcm16Layout(probe);
  } catch {
    return null;
  }
}

async function copyMonoPcm16Wav(
  sourcePath: string,
  destPath: string,
  layout: WavPcmLayout,
  displayName: string
): Promise<ConvertedImportAudio> {
  const source = new File(sourcePath);
  const dest = new File(destPath);
  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  const duration = durationFromLayoutFile(layout, dest);
  if (!(duration > 0)) {
    throw new Error(IMPORT_EMPTY_AUDIO_MESSAGE);
  }
  if (layout.sampleRate < 8000) {
    throw new Error(IMPORT_UNSUPPORTED_AUDIO_MESSAGE);
  }

  return {
    wavPath: dest.uri,
    duration,
    waveformPeaks: await peaksFromMonoWavWindows(dest.uri, duration),
    displayName,
  };
}

async function downmixPcm16WavToMono(
  sourcePath: string,
  destPath: string,
  layout: WavPcmLayout,
  displayName: string
): Promise<ConvertedImportAudio> {
  const source = new File(sourcePath);
  const fileSize = source.size ?? source.info().size ?? 0;
  const bytesPerFrame = layout.channels * 2;
  const onDisk = Math.max(0, fileSize - layout.dataOffset);
  const dataBytes =
    layout.dataSize > 0 && layout.dataSize <= onDisk ? layout.dataSize : onDisk;
  const frameCount = Math.floor(dataBytes / bytesPerFrame);
  if (frameCount <= 0) {
    throw new Error(IMPORT_EMPTY_AUDIO_MESSAGE);
  }
  if (layout.sampleRate < 8000) {
    throw new Error(IMPORT_UNSUPPORTED_AUDIO_MESSAGE);
  }

  const duration = frameCount / layout.sampleRate;
  const header = buildMonoPcm16WavHeader(layout.sampleRate, frameCount);
  const dest = new File(destPath);
  if (dest.exists) {
    dest.delete();
  }
  dest.create();
  dest.write(header);

  const peaks: number[] = [];
  const windowFrames = Math.max(1, Math.floor(layout.sampleRate * IMPORT_WAV_WINDOW_SEC));
  const handle = dest.open(FileMode.ReadWrite);
  try {
    handle.offset = 44;
    for (let frame = 0; frame < frameCount; frame += windowFrames) {
      const count = Math.min(windowFrames, frameCount - frame);
      const byteStart = layout.dataOffset + frame * bytesPerFrame;
      const pcm = readFileBytesRange(source, byteStart, byteStart + count * bytesPerFrame);
      const mono = downmixInterleavedPcm16ToMono(pcm, layout.channels);
      accumulatePeaksFromSamples(mono, frame / layout.sampleRate, layout.sampleRate, peaks);
      handle.writeBytes(floatSamplesToPcm16Bytes(mono));
    }
  } finally {
    handle.close();
  }

  return {
    wavPath: dest.uri,
    duration,
    waveformPeaks: finalizeImportPeaks(peaks, duration),
    displayName,
  };
}

async function decodeAndWriteMonoWav(
  sourcePath: string,
  destPath: string,
  displayName: string
): Promise<ConvertedImportAudio> {
  try {
    const { decodeAudioData } = await import('react-native-audio-api');
    const buffer = await decodeAudioData(sourcePath);
    if (!buffer || buffer.sampleRate < 8000) {
      throw new Error(IMPORT_UNSUPPORTED_AUDIO_MESSAGE);
    }

    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index += 1) {
      channels.push(buffer.getChannelData(index));
    }
    const mono = downmixAudioChannelsToMono(channels);
    if (mono.length === 0) {
      throw new Error(IMPORT_EMPTY_AUDIO_MESSAGE);
    }

    const duration = mono.length / buffer.sampleRate;
    if (!(duration > 0)) {
      throw new Error(IMPORT_EMPTY_AUDIO_MESSAGE);
    }

    writeMonoPcm16Wav(mono, buffer.sampleRate, destPath);
    return {
      wavPath: destPath,
      duration,
      waveformPeaks: computeWaveformPeaksFromChannelData(
        mono,
        peakCountForDuration(duration)
      ),
      displayName,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message === IMPORT_UNSUPPORTED_AUDIO_MESSAGE ||
        error.message === IMPORT_EMPTY_AUDIO_MESSAGE ||
        error.message === IMPORT_TOO_LARGE_MESSAGE
      ) {
        throw error;
      }
    }
    throw new Error(IMPORT_UNREADABLE_AUDIO_MESSAGE);
  }
}

async function peaksFromMonoWavWindows(
  path: string,
  duration: number
): Promise<number[]> {
  const peaks: number[] = [];
  for (let startSec = 0; startSec < duration; startSec += IMPORT_WAV_WINDOW_SEC) {
    const window = await readWavMonoSamplesWindow(path, {
      startSec,
      maxSec: IMPORT_WAV_WINDOW_SEC,
    });
    if (!window) {
      continue;
    }
    accumulatePeaksFromSamples(window.samples, startSec, window.sampleRate, peaks);
  }
  return finalizeImportPeaks(peaks, duration);
}

function finalizeImportPeaks(peaks: number[], duration: number): number[] {
  const peakCount = peakCountForDuration(duration);
  if (peaks.length === 0) {
    return Array.from({ length: peakCount }, () => 0);
  }
  return resamplePeaks(peaks.map(peakToAbsoluteScale), peakCount);
}

function durationFromLayoutFile(layout: WavPcmLayout, file: File): number {
  const fileSize = file.size ?? file.info().size ?? 0;
  const fromDisk = wavDurationSecFromFileSize(layout, fileSize);
  if (fromDisk > 0) {
    return fromDisk;
  }
  return wavDurationSecFromLayout(layout);
}

function readFileBytesRange(file: File, byteStart: number, byteEnd: number): Uint8Array {
  const length = Math.max(0, byteEnd - byteStart);
  if (length <= 0) {
    return new Uint8Array(0);
  }
  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = byteStart;
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

function floatToPcm16(sample: number): number {
  return sample <= -1 ? -32768 : sample >= 1 ? 32767 : (sample * 0x7fff) | 0;
}

function floatSamplesToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(i * 2, floatToPcm16(samples[i] ?? 0), true);
  }
  return bytes;
}

function buildMonoPcm16WavHeader(sampleRate: number, frameCount: number): Uint8Array {
  const sr = Math.round(sampleRate);
  const dataSize = frameCount * 2;
  const totalSize = 44 + dataSize;
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
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
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
}
