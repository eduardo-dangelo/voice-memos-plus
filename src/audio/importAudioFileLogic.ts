export const IMPORT_DECODE_MAX_BYTES = 12 * 1024 * 1024;
export const IMPORT_DECODE_MAX_MB = Math.round(IMPORT_DECODE_MAX_BYTES / (1024 * 1024));
export const IMPORT_DISPLAY_NAME_MAX_LENGTH = 80;
export const IMPORT_FALLBACK_NAME = 'Imported Recording';
export const IMPORT_TOO_LARGE_MESSAGE = `This file is too large to import. Maximum size is ${IMPORT_DECODE_MAX_MB} MB.`;
export const IMPORT_EMPTY_AUDIO_MESSAGE = 'This audio file is empty.';
export const IMPORT_UNSUPPORTED_AUDIO_MESSAGE = 'This audio file is unsupported.';
export const IMPORT_UNREADABLE_AUDIO_MESSAGE = 'Could not read this audio file.';

export function displayNameFromAudioFileName(name: string): string {
  const trimmed = name.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot === 0) {
    return IMPORT_FALLBACK_NAME;
  }
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const cleaned = base.replace(/\s+/g, ' ').trim().slice(0, IMPORT_DISPLAY_NAME_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : IMPORT_FALLBACK_NAME;
}

export function isImportDecodeTooLarge(sizeBytes: number | undefined): boolean {
  return (sizeBytes ?? 0) > IMPORT_DECODE_MAX_BYTES;
}

export function downmixInterleavedPcm16ToMono(
  pcmBytes: Uint8Array,
  channels: number
): Float32Array {
  const channelCount = Math.max(1, Math.floor(channels));
  const frames = Math.floor(pcmBytes.byteLength / (channelCount * 2));
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sum += view.getInt16((frame * channelCount + channel) * 2, true) / 0x8000;
    }
    out[frame] = sum / channelCount;
  }
  return out;
}

export function downmixAudioChannelsToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0] ?? new Float32Array(0);
  }
  const length = Math.min(...channels.map((channel) => channel.length));
  const out = new Float32Array(Math.max(0, length));
  const count = channels.length;
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (const channel of channels) {
      sum += channel[i] ?? 0;
    }
    out[i] = sum / count;
  }
  return out;
}
