import { File } from 'expo-file-system';

import {
  parseWavPcm16MonoLayout,
  type WavPcmLayout,
} from '@/src/audio/wavPcmLayout';

export type WavMonoWindow = {
  samples: Float32Array;
  sampleRate: number;
};

export { parseWavPcm16MonoLayout };
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
    const probe = new Uint8Array(await file.slice(0, probeLen).arrayBuffer());
    const layout = parseWavPcm16MonoLayout(probe);
    if (!layout) {
      return null;
    }

    const bytesPerFrame = 2; // mono PCM16
    const startSample = Math.floor(startSec * layout.sampleRate);
    const sampleCount = Math.max(1, Math.floor(maxSec * layout.sampleRate));
    const dataEnd = layout.dataOffset + layout.dataSize;
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
        : new Uint8Array(await file.slice(byteStart, byteEnd).arrayBuffer());

    return {
      samples: pcm16ToFloat32(pcmBytes),
      sampleRate: layout.sampleRate,
    };
  } catch {
    return null;
  }
}
