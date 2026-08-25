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

/**
 * How cues were heard during capture.
 * `speakerBleed` — open speaker/room path; mic may record acoustic bleed.
 * `headphones` — sealed/cued path; performer hears software cues without bleed.
 */
export type MonitorPath = 'headphones' | 'speakerBleed';

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

/** Open room outputs — acoustic bleed into the phone mic is likely. */
const SPEAKER_BLEED_OUTPUT_CATEGORIES = new Set([
  'BuiltInSpeaker',
  'BuiltInReceiver',
  'AirPlay',
  'CarAudio',
  'HDMI',
]);

/**
 * Sealed / private cue paths — no same-device speaker bleed into the mic.
 * BluetoothA2DP is treated as sealed for trim (AirPods) but may still duck
 * for open BT speakers via `shouldDuckMonitorMixForCategory`.
 */
const SEALED_HEADPHONE_CATEGORIES = new Set([
  'Headphones',
  'HeadsetMic',
  'USBAudio',
  'LineOut',
  'BluetoothHFP',
  'BluetoothLE',
  'BluetoothA2DP',
]);

/**
 * Per-route software-cue compensation (seconds).
 * Wired tuned on-device; bluetooth is a starting point (~130ms above wired)
 * for A2DP stacks — raise/lower in ~20ms steps after clap/metro tests.
 * Speaker matches wired until measured separately (fallback only; speakerBleed
 * uses wake-only trim).
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

/** Clamp measured AudioContext lead to a sane cue window. */
const MEASURED_CUE_LEAD_MIN_SEC = 0;
const MEASURED_CUE_LEAD_MAX_SEC = 0.5;

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

/** Classify whether capture heard cues privately or via open/room bleed. */
export function classifyMonitorPath(
  outputCategory: string | null | undefined
): MonitorPath {
  if (!outputCategory) {
    return 'headphones';
  }
  if (SPEAKER_BLEED_OUTPUT_CATEGORIES.has(outputCategory)) {
    return 'speakerBleed';
  }
  if (outputCategory.toLowerCase().includes('speaker')) {
    return 'speakerBleed';
  }
  return 'headphones';
}

/** True for sealed private cue paths (wired / in-ear BT). */
export function isSealedHeadphoneCategory(
  outputCategory: string | null | undefined
): boolean {
  if (!outputCategory) {
    return false;
  }
  return SEALED_HEADPHONE_CATEGORIES.has(outputCategory);
}

/**
 * Duck monitor mix on open outputs (built-in speaker, room remotes, A2DP
 * speakers) so mic bleed is quieter during stack/replace.
 */
export function shouldDuckMonitorMixForCategory(
  outputCategory: string | null | undefined
): boolean {
  if (!outputCategory) {
    return false;
  }
  if (SPEAKER_BLEED_OUTPUT_CATEGORIES.has(outputCategory)) {
    return true;
  }
  // A2DP often drives open BT speakers; ducking AirPods is mild (−8 dB).
  if (outputCategory === 'BluetoothA2DP') {
    return true;
  }
  if (outputCategory.toLowerCase().includes('speaker')) {
    return true;
  }
  return false;
}

export function getSoftwareCueCompensationSec(route: CueOutputRoute): number {
  return Math.max(
    0,
    SOFTWARE_CUE_COMPENSATION_BY_ROUTE[route] ??
      SOFTWARE_CUE_COMPENSATION_BY_ROUTE.wired
  );
}

export type RecordingLatencySkipOptions = {
  softwareCue?: boolean;
  cueRoute?: CueOutputRoute;
  /** Measured AudioContext lead from recorder start to first scheduled cue. */
  measuredCueLeadSec?: number;
  /** How cues were heard; speakerBleed uses wake-only when software cues ran. */
  monitorPath?: MonitorPath;
};

function clampMeasuredCueLeadSec(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(
    MEASURED_CUE_LEAD_MAX_SEC,
    Math.max(MEASURED_CUE_LEAD_MIN_SEC, value)
  );
}

/**
 * Shared wake(+cue) seconds for first/stack trimIn, replace PCM skip, and live
 * waveform lead. Keep all three consumers on this single helper.
 */
export function getRecordingLatencySkipSeconds(
  options?: RecordingLatencySkipOptions
): number {
  const wake = Math.max(0, RECORDING_WAKE_TRIM_SEC);
  if (options?.softwareCue !== true) {
    return wake;
  }

  const measured =
    options.measuredCueLeadSec != null
      ? clampMeasuredCueLeadSec(options.measuredCueLeadSec)
      : null;
  const measuredOrZero =
    measured != null && measured > 0.001 ? measured : 0;

  const monitorPath = options.monitorPath ?? 'headphones';
  // Open-speaker bleed: never apply the headphones route constant (~150ms) —
  // that double-counts acoustic capture. Still fold measured commit lead so
  // stacked takes share the same file offset for identical clicks.
  if (monitorPath === 'speakerBleed') {
    return wake + measuredOrZero;
  }

  // Headphones: route constant was tuned including typical commit lead —
  // do not also add measuredCueLeadSec (over-trims). Measured is logged for DEV.
  const cueRoute = options.cueRoute ?? 'wired';
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    measured != null &&
    measured > 0.001
  ) {
    console.log(
      `[audio] headphones measuredCueLead=${(measured * 1000).toFixed(1)}ms ` +
        `(not added to wake+route trim)`
    );
  }
  return wake + getSoftwareCueCompensationSec(cueRoute);
}

/** Seconds to skip at the start of a replace-splice replacement buffer. */
export function getRecordingReplacementSkipSeconds(
  softwareCue: boolean,
  route: CueOutputRoute = 'wired',
  options?: Omit<RecordingLatencySkipOptions, 'softwareCue' | 'cueRoute'>
): number {
  return getRecordingLatencySkipSeconds({
    softwareCue,
    cueRoute: route,
    measuredCueLeadSec: options?.measuredCueLeadSec,
    monitorPath: options?.monitorPath,
  });
}

export type RecordingLatencyTrimOptions = RecordingLatencySkipOptions;

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
  const monitorPath = options?.monitorPath ?? 'headphones';
  const totalRequested = getRecordingLatencySkipSeconds(options);

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
    const cuePart = Math.max(0, trimIn - RECORDING_WAKE_TRIM_SEC);
    console.log(
      `[audio] latency trim route=${cueRoute} path=${monitorPath} ` +
        `wake=${RECORDING_WAKE_TRIM_SEC.toFixed(3)}s ` +
        `cue=${cuePart.toFixed(3)}s trimIn=${trimIn.toFixed(3)}s ` +
        `startTime=${layer.startTime.toFixed(3)}s activeStart=${activeStart.toFixed(3)}s`
    );
  }
}
