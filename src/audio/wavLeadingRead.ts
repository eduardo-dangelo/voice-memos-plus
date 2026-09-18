import { File, FileMode } from 'expo-file-system';

import {
  MIN_SALVAGE_WAV_DURATION_SEC,
  parseWavPcm16MonoLayout,
  wavDataBytesOnDisk,
  wavDurationSecFromFileSize,
  wavDurationSecFromLayout,
  wavHeaderNeedsSalvage,
  wavSalvageSizePatches,
  type WavPcmLayout,
} from '@/src/audio/wavPcmLayout';

/**
 * Ranged byte read via FileHandle. Prefer this over Blob.slice — on native,
 * File.slice().arrayBuffer() can return empty for mid-file windows (breaks
 * 16s PCM paging while decodeAudioData still works).
 */
function readFileBytesRange(
  file: File,
  byteStart: number,
  byteEnd: number
): Uint8Array {
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

export type WavMonoWindow = {
  samples: Float32Array;
  sampleRate: number;
};

export {
  MIN_SALVAGE_WAV_DURATION_SEC,
  parseWavPcm16MonoLayout,
  wavDurationSecFromFileSize,
  wavDurationSecFromLayout,
  wavHeaderNeedsSalvage,
  wavSalvageSizePatches,
};
export type { WavPcmLayout };

function pcm16ToFloat32(pcmBytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

/**
 * Read WAV data-chunk duration from the header without decoding samples.
 * Returns null for non-WAV / non-PCM16-mono / unreadable files.
 */
export async function readWavDurationSec(path: string): Promise<number | null> {
  if (!path.toLowerCase().endsWith('.wav')) {
    return null;
  }
  try {
    const file = new File(path);
    if (!file.exists) {
      return null;
    }
    const fileSize = file.size ?? file.info().size ?? 0;
    if (fileSize < 44) {
      return null;
    }
    const probeLen = Math.min(fileSize, 64 * 1024);
    const probe = readFileBytesRange(file, 0, probeLen);
    const layout = parseWavPcm16MonoLayout(probe);
    if (!layout || layout.sampleRate < 8000) {
      return null;
    }
    const fromDisk = wavDurationSecFromFileSize(layout, fileSize);
    if (fromDisk > 0) {
      return fromDisk;
    }
    const duration = wavDurationSecFromLayout(layout);
    return duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

/**
 * Read a mono PCM16 WAV window without decoding the whole file.
 * Returns null for non-WAV / non-PCM16 / unreadable files (caller falls back).
 */
export async function readWavMonoSamplesWindow(
  path: string,
  options: { startSec?: number; maxSec: number }
): Promise<WavMonoWindow | null> {
  if (!path.toLowerCase().endsWith('.wav')) {
    return null;
  }
  const startSec = Math.max(0, options.startSec ?? 0);
  const maxSec = Math.max(0, options.maxSec);
  if (maxSec <= 0) {
    return null;
  }

  try {
    const file = new File(path);
    if (!file.exists) {
      return null;
    }
    const fileSize = file.size ?? file.info().size ?? 0;
    if (fileSize < 44) {
      return null;
    }

    // Header probe — enough for standard + small LIST metadata before data.
    const probeLen = Math.min(fileSize, 64 * 1024);
    const probe = readFileBytesRange(file, 0, probeLen);
    const layout = parseWavPcm16MonoLayout(probe);
    if (!layout) {
      return null;
    }

    const bytesPerFrame = 2; // mono PCM16
    const startSample = Math.floor(startSec * layout.sampleRate);
    const sampleCount = Math.max(1, Math.floor(maxSec * layout.sampleRate));
    const onDisk = wavDataBytesOnDisk(layout, fileSize);
    const dataBytes =
      layout.dataSize > 0 && layout.dataSize <= onDisk ? layout.dataSize : onDisk;
    const dataEnd = layout.dataOffset + dataBytes;
    const byteStart = layout.dataOffset + startSample * bytesPerFrame;
    if (byteStart >= dataEnd) {
      return null;
    }
    const byteEnd = Math.min(dataEnd, byteStart + sampleCount * bytesPerFrame);
    if (byteEnd <= byteStart) {
      return null;
    }

    const pcmBytes =
      byteStart < probeLen && byteEnd <= probeLen
        ? probe.subarray(byteStart, byteEnd)
        : readFileBytesRange(file, byteStart, byteEnd);
    if (pcmBytes.byteLength < 2) {
      return null;
    }

    return {
      samples: pcm16ToFloat32(pcmBytes),
      sampleRate: layout.sampleRate,
    };
  } catch {
    return null;
  }
}

function writeUint32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

/**
 * Rewrite RIFF/data sizes on a streaming WAV that never got a final header.
 * Returns on-disk duration, or null when the file is missing/tiny/unreadable.
 */
export async function salvageIncompleteWavHeader(
  path: string
): Promise<number | null> {
  if (!path.toLowerCase().endsWith('.wav')) {
    return null;
  }
  try {
    const file = new File(path);
    if (!file.exists) {
      return null;
    }
    const fileSize = file.size ?? file.info().size ?? 0;
    if (fileSize < 44) {
      return null;
    }
    const probeLen = Math.min(fileSize, 64 * 1024);
    const probe = readFileBytesRange(file, 0, probeLen);
    const layout = parseWavPcm16MonoLayout(probe);
    if (!layout || layout.sampleRate < 8000) {
      return null;
    }
    const duration = wavDurationSecFromFileSize(layout, fileSize);
    if (duration < MIN_SALVAGE_WAV_DURATION_SEC) {
      return null;
    }
    if (!wavHeaderNeedsSalvage(layout, fileSize)) {
      return duration;
    }
    const patches = wavSalvageSizePatches(layout, fileSize);
    if (!patches) {
      return null;
    }
    const handle = file.open();
    try {
      handle.offset = 4;
      handle.writeBytes(writeUint32Le(patches.riffChunkSize));
      handle.offset = patches.dataSizeFieldOffset;
      handle.writeBytes(writeUint32Le(patches.dataChunkSize));
    } finally {
      handle.close();
    }
    return duration;
  } catch {
    return null;
  }
}
