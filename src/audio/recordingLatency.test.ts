import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyRecordingIoLatencyTrim,
  classifyCueOutputRoute,
  getRecordingReplacementSkipSeconds,
  getSoftwareCueCompensationSec,
  RECORDING_WAKE_TRIM_SEC,
  SOFTWARE_CUE_COMPENSATION_BY_ROUTE,
  SOFTWARE_CUE_OUTPUT_COMPENSATION_SEC,
} from './recordingLatency';
import type { Layer } from '@/src/storage/types';

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    order: 0,
    fileName: 'track.wav',
    label: 'Track 1',
    startTime: 4,
    duration: 10,
    effects: { trimIn: 0, trimOut: 10 },
    ...overrides,
  };
}

describe('classifyCueOutputRoute', () => {
  it('maps wired headphone categories', () => {
    assert.equal(classifyCueOutputRoute('Headphones'), 'wired');
    assert.equal(classifyCueOutputRoute('HeadsetMic'), 'wired');
    assert.equal(classifyCueOutputRoute('USBAudio'), 'wired');
    assert.equal(classifyCueOutputRoute('LineOut'), 'wired');
  });

  it('maps bluetooth and elevated remote categories', () => {
    assert.equal(classifyCueOutputRoute('BluetoothA2DP'), 'bluetooth');
    assert.equal(classifyCueOutputRoute('BluetoothLE'), 'bluetooth');
    assert.equal(classifyCueOutputRoute('AirPlay'), 'bluetooth');
    assert.equal(classifyCueOutputRoute('CarAudio'), 'bluetooth');
    assert.equal(classifyCueOutputRoute('HDMI'), 'bluetooth');
  });

  it('maps speaker categories', () => {
    assert.equal(classifyCueOutputRoute('BuiltInSpeaker'), 'speaker');
    assert.equal(classifyCueOutputRoute('BuiltInReceiver'), 'speaker');
  });

  it('defaults missing/unknown categories to wired', () => {
    assert.equal(classifyCueOutputRoute(null), 'wired');
    assert.equal(classifyCueOutputRoute(undefined), 'wired');
    assert.equal(classifyCueOutputRoute(''), 'wired');
  });
});

describe('getSoftwareCueCompensationSec', () => {
  it('keeps wired alias aligned with the wired table entry', () => {
    assert.equal(
      SOFTWARE_CUE_OUTPUT_COMPENSATION_SEC,
      SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired
    );
    assert.equal(getSoftwareCueCompensationSec('wired'), 0.15);
    assert.equal(getSoftwareCueCompensationSec('speaker'), 0.15);
    assert.equal(getSoftwareCueCompensationSec('bluetooth'), 0.28);
  });
});

const WIRED_SKIP =
  RECORDING_WAKE_TRIM_SEC + SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired;
const BLUETOOTH_SKIP =
  RECORDING_WAKE_TRIM_SEC + SOFTWARE_CUE_COMPENSATION_BY_ROUTE.bluetooth;

describe('getRecordingReplacementSkipSeconds', () => {
  it('returns wake only when softwareCue is false', () => {
    assert.equal(getRecordingReplacementSkipSeconds(false), RECORDING_WAKE_TRIM_SEC);
    assert.equal(
      getRecordingReplacementSkipSeconds(false, 'bluetooth'),
      RECORDING_WAKE_TRIM_SEC
    );
  });

  it('adds wired cue compensation by default', () => {
    assert.equal(getRecordingReplacementSkipSeconds(true), WIRED_SKIP);
    assert.equal(getRecordingReplacementSkipSeconds(true, 'wired'), WIRED_SKIP);
  });

  it('adds bluetooth cue compensation when requested', () => {
    assert.equal(
      getRecordingReplacementSkipSeconds(true, 'bluetooth'),
      BLUETOOTH_SKIP
    );
  });
});

describe('applyRecordingIoLatencyTrim', () => {
  it('folds wake+wired cue into trimIn and pulls startTime', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, { softwareCue: true, cueRoute: 'wired' });
    assert.equal(layer.effects?.trimIn, WIRED_SKIP);
    assert.equal(layer.startTime, 4 - WIRED_SKIP);
  });

  it('uses larger bluetooth cue compensation', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'bluetooth',
    });
    assert.equal(layer.effects?.trimIn, BLUETOOTH_SKIP);
    assert.equal(layer.startTime, 4 - BLUETOOTH_SKIP);
  });

  it('defaults missing cueRoute to wired', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, { softwareCue: true });
    assert.equal(layer.effects?.trimIn, WIRED_SKIP);
  });

  it('applies wake-only trim without software cues', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: false,
      cueRoute: 'bluetooth',
    });
    assert.equal(layer.effects?.trimIn, RECORDING_WAKE_TRIM_SEC);
    assert.equal(layer.startTime, 4 - RECORDING_WAKE_TRIM_SEC);
  });
});
