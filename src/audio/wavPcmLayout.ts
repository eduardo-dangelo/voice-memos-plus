export type WavPcmLayout = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
};

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

/**
 * Parse a PCM WAV header from a byte prefix. Returns null when the layout is
 * not mono PCM16 (caller should fall back to full decode).
 */
export function parseWavPcm16MonoLayout(bytes: Uint8Array): WavPcmLayout | null {
  if (bytes.length < 44) {
    return null;
  }
  if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const id = readFourCC(bytes, offset);
    const size =
      bytes[offset + 4]! |
      (bytes[offset + 5]! << 8) |
      (bytes[offset + 6]! << 16) |
      (bytes[offset + 7]! << 24);
    const chunkData = offset + 8;

    if (id === 'fmt ' && chunkData + 16 <= bytes.length) {
      audioFormat = bytes[chunkData]! | (bytes[chunkData + 1]! << 8);
      channels = bytes[chunkData + 2]! | (bytes[chunkData + 3]! << 8);
      sampleRate =
        bytes[chunkData + 4]! |
        (bytes[chunkData + 5]! << 8) |
        (bytes[chunkData + 6]! << 16) |
        (bytes[chunkData + 7]! << 24);
      bitsPerSample = bytes[chunkData + 14]! | (bytes[chunkData + 15]! << 8);
    } else if (id === 'data') {
      dataOffset = chunkData;
      dataSize = size;
      break;
    }

    // Chunk sizes are word-aligned.
    offset = chunkData + size + (size % 2);
  }

  if (
    dataOffset < 0 ||
    sampleRate < 8000 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    audioFormat !== 1
  ) {
    return null;
  }

  return { sampleRate, channels, bitsPerSample, dataOffset, dataSize };
}
