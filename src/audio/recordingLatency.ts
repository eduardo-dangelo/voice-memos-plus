import { mergeLayerEffects } from '@/src/audio/layerEffects';
import type { Layer } from '@/src/storage/types';
import { clampLayerStartTime, getLayerEffects } from '@/src/storage/types';

/**
 * Skip leading recorder/file junk after JS-side record start.
 * Included in layer `trimIn` and in replace-splice skip via
 * `getRecordingReplacementSkipSeconds`.
 */
export const RECORDING_WAKE_TRIM_SEC = 0.02;

/**
 * Cue-output route class for software-cue latency compensation.
 * Remote outputs (AirPlay / CarAudio / HDMI) map to `bluetooth` so they
 * never silently get the wired constant.
 */
export type CueOutputRoute = 'wired' | 'bluetooth' | 'speaker';

const WIRED_OUTPUT_CATEGORIES = new Set([
  'Headphones',
  'HeadsetMic',
  'USBAudio',
  'LineOut',
]);

const BLUETOOTH_OUTPUT_CATEGORIES = new Set([
  'BluetoothA2DP',
  'BluetoothLE',
  // Elevated external routes — treat like BT (not wired).
  'AirPlay',
  'CarAudio',
  'HDMI',
]);

const SPEAKER_OUTPUT_CATEGORIES = new Set([
  'BuiltInSpeaker',
  'BuiltInReceiver',
]);

/**
 * Per-route software-cue compensation (seconds).
 * Wired tuned on-device; bluetooth is a starting point (~130ms above wired)
 * for A2DP stacks — raise/lower in ~20ms steps after clap/metro tests.
 * Speaker matches wired until measured separately.
 */
export const SOFTWARE_CUE_COMPENSATION_BY_ROUTE: Record<CueOutputRoute, number> =
  {
    wired: 0.15,
    bluetooth: 0.28,
    speaker: 0.15,
  };

/** Wired alias — kept for callers/tests that mean the wired baseline. */
export const SOFTWARE_CUE_OUTPUT_COMPENSATION_SEC =
  SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired;

/** Classify iOS output category into a cue-compensation route. Defaults to wired. */
export function classifyCueOutputRoute(
  outputCategory: string | null | undefined
): CueOutputRoute {
  if (!outputCategory) {
    return 'wired';
  }
  if (BLUETOOTH_OUTPUT_CATEGORIES.has(outputCategory)) {
    return 'bluetooth';
  }
  if (SPEAKER_OUTPUT_CATEGORIES.has(outputCategory)) {
    return 'speaker';
  }
  if (WIRED_OUTPUT_CATEGORIES.has(outputCategory)) {
    return 'wired';
  }
  // Unknown non-speaker external ports: prefer elevated compensation.
  if (outputCategory.toLowerCase().includes('bluetooth')) {
    return 'bluetooth';
  }
  if (outputCategory.toLowerCase().includes('speaker')) {
    return 'speaker';
  }
  return 'wired';
}

export function getSoftwareCueCompensationSec(route: CueOutputRoute): number {
  return Math.max(0, SOFTWARE_CUE_COMPENSATION_BY_ROUTE[route] ?? SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired);
}

/** Seconds to skip at the start of a replace-splice replacement buffer. */
export function getRecordingReplacementSkipSeconds(
  softwareCue: boolean,
  route: CueOutputRoute = 'wired'
): number {
  const wake = Math.max(0, RECORDING_WAKE_TRIM_SEC);
  const cue = softwareCue ? getSoftwareCueCompensationSec(route) : 0;
  return wake + cue;
}

export type RecordingLatencyTrimOptions = {
  /** True when AudioContext cues (layers and/or metronome) played during the take. */
  softwareCue?: boolean;
  /** Output route used while hearing software cues. Defaults to wired. */
  cueRoute?: CueOutputRoute;
};

/**
 * Apply wake trim and, for software-cued takes, pull the take earlier via
 * startTime while folding wake+cue into trimIn so the active region starts
 * on the session timeline (DAW-style overdub latency compensation).
 */
export function applyRecordingIoLatencyTrim(
  layer: Layer,
  options?: RecordingLatencyTrimOptions
): void {
  const cueRoute = options?.cueRoute ?? 'wired';
  const cueCompensation =
    options?.softwareCue === true
      ? getSoftwareCueCompensationSec(cueRoute)
      : 0;
  const wake = Math.max(0, RECORDING_WAKE_TRIM_SEC);
  const totalRequested = wake + cueCompensation;

  if (totalRequested <= 0 || layer.duration <= totalRequested * 2) {
    return;
  }

  const trimIn = Math.min(
    totalRequested,
    Math.max(0, layer.duration - 0.05)
  );
  if (trimIn <= 0.001) {
    return;
  }

  const desiredStart = layer.startTime - trimIn;
  const effects = getLayerEffects(layer);
  layer.effects = mergeLayerEffects(effects, { trimIn }, layer.duration);
  layer.startTime = clampLayerStartTime(desiredStart, trimIn);

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const activeStart = layer.startTime + trimIn;
    console.log(
      `[audio] latency trim route=${cueRoute} wake=${wake.toFixed(3)}s ` +
        `cue=${cueCompensation.toFixed(3)}s trimIn=${trimIn.toFixed(3)}s ` +
        `startTime=${layer.startTime.toFixed(3)}s activeStart=${activeStart.toFixed(3)}s`
    );
  }
}
