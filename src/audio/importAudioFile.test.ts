import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  displayNameFromAudioFileName,
  downmixAudioChannelsToMono,
  downmixInterleavedPcm16ToMono,
  IMPORT_DECODE_MAX_BYTES,
  IMPORT_FALLBACK_NAME,
  IMPORT_DISPLAY_NAME_MAX_LENGTH,
  IMPORT_TOO_LARGE_MESSAGE,
  isImportDecodeTooLarge,
} from './importAudioFileLogic';

describe('displayNameFromAudioFileName', () => {
  it('strips the extension', () => {
    assert.equal(displayNameFromAudioFileName('Take 3.wav'), 'Take 3');
    assert.equal(displayNameFromAudioFileName('song.mp3'), 'song');
  });

  it('caps the name at 80 characters', () => {
    const long = `${'a'.repeat(100)}.m4a`;
    assert.equal(displayNameFromAudioFileName(long).length, IMPORT_DISPLAY_NAME_MAX_LENGTH);
  });

  it('falls back when the name is empty or extension-only', () => {
    assert.equal(displayNameFromAudioFileName(''), IMPORT_FALLBACK_NAME);
    assert.equal(displayNameFromAudioFileName('   .wav'), IMPORT_FALLBACK_NAME);
    assert.equal(displayNameFromAudioFileName('   '), IMPORT_FALLBACK_NAME);
  });
});

describe('isImportDecodeTooLarge', () => {
  it('refuses files over 12MB', () => {
    assert.equal(isImportDecodeTooLarge(IMPORT_DECODE_MAX_BYTES), false);
    assert.equal(isImportDecodeTooLarge(IMPORT_DECODE_MAX_BYTES + 1), true);
    assert.equal(isImportDecodeTooLarge(undefined), false);
    assert.match(IMPORT_TOO_LARGE_MESSAGE, /12 MB/);
  });
});

describe('downmixInterleavedPcm16ToMono', () => {
  it('averages stereo frames', () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setInt16(0, 16384, true);
    view.setInt16(2, -16384, true);
    view.setInt16(4, 32767, true);
    view.setInt16(6, 32767, true);
    const mono = downmixInterleavedPcm16ToMono(bytes, 2);
    assert.equal(mono.length, 2);
    assert.ok(Math.abs(mono[0] ?? 0) < 0.001);
    assert.ok((mono[1] ?? 0) > 0.99);
  });

  it('uses the shorter channel when the byte length is uneven', () => {
    const bytes = new Uint8Array(6);
    const view = new DataView(bytes.buffer);
    view.setInt16(0, 1000, true);
    view.setInt16(2, 2000, true);
    view.setInt16(4, 3000, true);
    const mono = downmixInterleavedPcm16ToMono(bytes, 2);
    assert.equal(mono.length, 1);
  });
});

describe('downmixAudioChannelsToMono', () => {
  it('averages float channels and uses the shorter length', () => {
    const left = new Float32Array([1, 0.5, 0.25]);
    const right = new Float32Array([-1, 0.5]);
    const mono = downmixAudioChannelsToMono([left, right]);
    assert.equal(mono.length, 2);
    assert.equal(mono[0], 0);
    assert.equal(mono[1], 0.5);
  });

  it('returns the only channel unchanged', () => {
    const samples = new Float32Array([0.2, -0.4]);
    assert.equal(downmixAudioChannelsToMono([samples]), samples);
  });
});
