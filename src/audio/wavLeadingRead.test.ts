import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseWavPcm16MonoLayout,
  wavDurationSecFromFileSize,
  wavDurationSecFromLayout,
  wavHeaderNeedsSalvage,
  wavSalvageSizePatches,
} from './wavPcmLayout';

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

describe('wav salvage from stale streaming header', () => {
  it('computes duration from file size when dataSize is zero', () => {
    const sampleRate = 44100;
    const sampleCount = 44100; // 1.0s
    const bytes = buildPcm16MonoWavBytes(sampleCount, sampleRate);
    const view = new DataView(bytes.buffer);
    view.setUint32(40, 0, true); // stale data chunk size
    const layout = parseWavPcm16MonoLayout(bytes);
    assert.ok(layout);
    assert.equal(layout!.dataSize, 0);
    assert.equal(wavDurationSecFromFileSize(layout!, bytes.byteLength), 1);
    assert.equal(wavHeaderNeedsSalvage(layout!, bytes.byteLength), true);
    const patches = wavSalvageSizePatches(layout!, bytes.byteLength);
    assert.ok(patches);
    assert.equal(patches!.dataChunkSize, sampleCount * 2);
    assert.equal(patches!.riffChunkSize, bytes.byteLength - 8);
    assert.equal(patches!.dataSizeFieldOffset, 40);
  });
});
