import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseWavPcm16MonoLayout, wavDurationSecFromLayout } from './wavPcmLayout';

function buildPcm16MonoWavBytes(
  sampleCount: number,
  sampleRate: number
): Uint8Array {
  const dataSize = sampleCount * 2;
  const totalSize = 44 + dataSize;
  const bytes = new Uint8Array(totalSize);
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
}

describe('parseWavPcm16MonoLayout', () => {
  it('parses a standard 44-byte PCM16 mono header', () => {
    const sampleRate = 44100;
    const bytes = buildPcm16MonoWavBytes(100, sampleRate);
    const layout = parseWavPcm16MonoLayout(bytes);
    assert.ok(layout);
    assert.equal(layout!.sampleRate, sampleRate);
    assert.equal(layout!.channels, 1);
    assert.equal(layout!.bitsPerSample, 16);
    assert.equal(layout!.dataOffset, 44);
    assert.equal(layout!.dataSize, 200);
  });

  it('rejects non-RIFF bytes', () => {
    assert.equal(parseWavPcm16MonoLayout(new Uint8Array(64)), null);
  });

  it('rejects stereo PCM', () => {
    const bytes = buildPcm16MonoWavBytes(40, 44100);
    bytes[22] = 2;
    bytes[23] = 0;
    assert.equal(parseWavPcm16MonoLayout(bytes), null);
  });
});

describe('wavDurationSecFromLayout', () => {
  it('returns sample-accurate duration for mono PCM16', () => {
    const sampleRate = 44100;
    const sampleCount = 88200; // 2.0s
    const bytes = buildPcm16MonoWavBytes(sampleCount, sampleRate);
    const layout = parseWavPcm16MonoLayout(bytes);
    assert.ok(layout);
    assert.equal(wavDurationSecFromLayout(layout!), 2);
  });
});
