import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/*
 * Device clap/metro checklist (after native rebuild):
 * - First take with metronome on wired headphones: downbeat lands on bar 1.
 * - Stack a second take at 0: transients lock without Aligning… spinner.
 * - Replace a middle region: splice in-time, no extra hole from skip mismatch.
 * - Precount sound/silent/off still commits on the downbeat.
 * - AirPods output + iPhone mic (not HFP): pin holds; bluetooth fallback only
 *   if AVAudioSession latencies read as 0.
 * - Lock-screen stop still saves; next record is not blocked.
 */

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

const WIRED_FALLBACK =
  RECORDING_WAKE_TRIM_SEC + SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired;
const BLUETOOTH_FALLBACK =
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
        inputLatencySec: 0.01,
        outputLatencySec: 0.08,
      }),
      RECORDING_WAKE_TRIM_SEC
    );
  });

  it('uses measured I/O plus commit lead (Logic placement)', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'wired',
        monitorPath: 'headphones',
        measuredCueLeadSec: 0.01,
        inputLatencySec: 0.012,
        outputLatencySec: 0.08,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.01 + 0.012 + 0.08
    );
  });

  it('uses the same measured formula for speakerBleed', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'speaker',
        monitorPath: 'speakerBleed',
        measuredCueLeadSec: 0.01,
        inputLatencySec: 0.012,
        outputLatencySec: 0.08,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.01 + 0.012 + 0.08
    );
  });

  it('falls back to wake+commit+route when I/O is missing', () => {
    assert.ok(
      Math.abs(
        getRecordingLatencySkipSeconds({
          softwareCue: true,
          cueRoute: 'wired',
          monitorPath: 'headphones',
          measuredCueLeadSec: 0.02,
        }) -
          (WIRED_FALLBACK + 0.02)
      ) < 1e-9
    );
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'bluetooth',
        monitorPath: 'headphones',
      }),
      BLUETOOTH_FALLBACK
    );
  });

  it('falls back to wake+route for speakerBleed when I/O is missing', () => {
    assert.equal(
      getRecordingLatencySkipSeconds({
        softwareCue: true,
        cueRoute: 'speaker',
        monitorPath: 'speakerBleed',
        measuredCueLeadSec: 0.03,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.03 + SOFTWARE_CUE_COMPENSATION_BY_ROUTE.speaker
    );
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
    assert.equal(getRecordingReplacementSkipSeconds(true), WIRED_FALLBACK);
    assert.equal(getRecordingReplacementSkipSeconds(true, 'wired'), WIRED_FALLBACK);
  });

  it('adds bluetooth cue compensation when requested', () => {
    assert.equal(
      getRecordingReplacementSkipSeconds(true, 'bluetooth'),
      BLUETOOTH_FALLBACK
    );
  });

  it('honors measured I/O via options', () => {
    assert.equal(
      getRecordingReplacementSkipSeconds(true, 'wired', {
        measuredCueLeadSec: 0.005,
        inputLatencySec: 0.01,
        outputLatencySec: 0.05,
      }),
      RECORDING_WAKE_TRIM_SEC + 0.005 + 0.01 + 0.05
    );
  });
});

describe('applyRecordingIoLatencyTrim', () => {
  it('folds measured I/O into trimIn and pulls startTime', () => {
    const layer = makeLayer();
    const skip = RECORDING_WAKE_TRIM_SEC + 0.01 + 0.012 + 0.08;
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'wired',
      monitorPath: 'headphones',
      measuredCueLeadSec: 0.01,
      inputLatencySec: 0.012,
      outputLatencySec: 0.08,
    });
    assert.equal(layer.effects?.trimIn, skip);
    assert.equal(layer.startTime, 4 - skip);
  });

  it('uses larger bluetooth fallback when I/O is missing', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: true,
      cueRoute: 'bluetooth',
      monitorPath: 'headphones',
    });
    assert.equal(layer.effects?.trimIn, BLUETOOTH_FALLBACK);
    assert.equal(layer.startTime, 4 - BLUETOOTH_FALLBACK);
  });

  it('defaults missing cueRoute to wired fallback', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, { softwareCue: true });
    assert.equal(layer.effects?.trimIn, WIRED_FALLBACK);
  });

  it('applies wake-only trim without software cues', () => {
    const layer = makeLayer();
    applyRecordingIoLatencyTrim(layer, {
      softwareCue: false,
      cueRoute: 'bluetooth',
      inputLatencySec: 0.01,
      outputLatencySec: 0.08,
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
      inputLatencySec: 0.01,
      outputLatencySec: 0.05,
    });
    const trimIn = layer.effects?.trimIn ?? 0;
    assert.ok(Math.abs(layer.startTime + trimIn - 2) < 1e-9);
  });
});
