import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyRecordingIoLatencyTrim,
  classifyCueOutputRoute,
  classifyMonitorPath,
  getRecordingLatencySkipSeconds,
  getRecordingReplacementSkipSeconds,
  getSoftwareCueCompensationSec,
  RECORDING_WAKE_TRIM_SEC,
  shouldDuckMonitorMixForCategory,
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

describe('classifyMonitorPath', () => {
  it('marks built-in and room remotes as speakerBleed', () => {
    assert.equal(classifyMonitorPath('BuiltInSpeaker'), 'speakerBleed');
    assert.equal(classifyMonitorPath('BuiltInReceiver'), 'speakerBleed');
    assert.equal(classifyMonitorPath('AirPlay'), 'speakerBleed');
    assert.equal(classifyMonitorPath('CarAudio'), 'speakerBleed');
    assert.equal(classifyMonitorPath('HDMI'), 'speakerBleed');
  });

  it('marks sealed paths as headphones', () => {
    assert.equal(classifyMonitorPath('Headphones'), 'headphones');
    assert.equal(classifyMonitorPath('BluetoothA2DP'), 'headphones');
    assert.equal(classifyMonitorPath('BluetoothLE'), 'headphones');
    assert.equal(classifyMonitorPath(null), 'headphones');
  });
});

describe('shouldDuckMonitorMixForCategory', () => {
  it('ducks open outputs including A2DP', () => {
    assert.equal(shouldDuckMonitorMixForCategory('BuiltInSpeaker'), true);
    assert.equal(shouldDuckMonitorMixForCategory('AirPlay'), true);
    assert.equal(shouldDuckMonitorMixForCategory('BluetoothA2DP'), true);
  });

  it('does not duck sealed wired headphones', () => {
    assert.equal(shouldDuckMonitorMixForCategory('Headphones'), false);
    assert.equal(shouldDuckMonitorMixForCategory('USBAudio'), false);
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

describe('getRecordingLatencySkipSeconds', () => {
  it('returns wake only when softwareCue is false', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({ softwareCue: false }),
      RECORDING_WAKE_TRIM_SEC
    );
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: false,
        cueRoute: 'bluetooth',
        measuredCueLeadSec: 0.2,
      }),
      RECORDING_WAKE_TRIM_SEC
    );
  });

  it('uses route constant for headphones when measured lead missing', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'wired',
        monitorPath: 'headphones',
      }),
      WIRED_SKIP
    );
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'bluetooth',
        monitorPath: 'headphones',
      }),
      BLUETOOTH_SKIP
    );
  });

  it('uses wake+route only for headphones (measured lead not additive)', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'wired',
        monitorPath: 'headphones',
        measuredCueLeadSec: 0.12,
      }),
      WIRED_SKIP
    );
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'bluetooth',
        monitorPath: 'headphones',
        measuredCueLeadSec: 0.08,
      }),
      BLUETOOTH_SKIP
    );
  });

  it('uses wake-only for speakerBleed when measured lead is missing', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'speaker',
        monitorPath: 'speakerBleed',
      }),
      RECORDING_WAKE_TRIM_SEC
    );
  });

  it('folds measured commit lead on speakerBleed without route constant', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'speaker',
        monitorPath: 'speakerBleed',
        measuredCueLeadSec: 0.03,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.03
    );
  });

  it('never applies the 150ms speaker route constant on speakerBleed', () => {
    const skip = getRecordingLatencySkipSeconds({
      softwareCue: true,
      cueRoute: 'speaker',
      monitorPath: 'speakerBleed',
      measuredCueLeadSec: 0.01,
    });
    assert.ok(skip < 0.05);
    assert.ok(skip < SOFTWARE_CUE_COMPENSATION_BY_ROUTE.speaker);
  });
});

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

  it('honors speakerBleed measured lead via options', () => {
    assert.equal(
      getRecordingReplacementSkipSeconds(true, 'speaker', {
        monitorPath: 'speakerBleed',
        measuredCueLeadSec: 0.025,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.025
    );
  });

  it('speakerBleed without measured lead stays wake-only', () => {
    assert.equal(
      getRecordingReplacementSkipSeconds(true, 'speaker', {
        monitorPath: 'speakerBleed',
      }),
      RECORDING_WAKE_TRIM_SEC
    );
  });
});

describe('applyRecordingIoLatencyTrim', () => {
  it('folds wake+wired cue into trimIn and pulls startTime', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'wired',
      monitorPath: 'headphones',
    });
    assert.equal(layer.effects?.trimIn, WIRED_SKIP);
    assert.equal(layer.startTime, 4 - WIRED_SKIP);
  });

  it('uses larger bluetooth cue compensation', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'bluetooth',
      monitorPath: 'headphones',
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

  it('applies wake+measured on speakerBleed path', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'speaker',
      monitorPath: 'speakerBleed',
      measuredCueLeadSec: 0.04,
    });
    assert.equal(layer.effects?.trimIn, RECORDING_WAKE_TRIM_SEC + 0.04);
    assert.equal(layer.startTime, 4 - (RECORDING_WAKE_TRIM_SEC + 0.04));
  });

  it('applies wake-only on speakerBleed when measured lead missing', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'speaker',
      monitorPath: 'speakerBleed',
    });
    assert.equal(layer.effects?.trimIn, RECORDING_WAKE_TRIM_SEC);
    assert.equal(layer.startTime, 4 - RECORDING_WAKE_TRIM_SEC);
  });

  it('preserves activeStart after fold', () => {
    const layer = makeLayer({ startTime: 2 });
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'wired',
      monitorPath: 'headphones',
    });
    const trimIn = layer.effects?.trimIn ?? 0;
    assert.ok(Math.abs(layer.startTime + trimIn - 2) < 1e-9);
  });
});
