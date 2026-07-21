import { mergeLayerEffects } from '@/src/audio/layerEffects';
import type { Layer } from '@/src/storage/types';
import { clampLayerStartTime, getLayerEffects } from '@/src/storage/types';

/**
 * Skip leading recorder/file junk after JS-side record start.
 * Used as `trimIn` and as replace-splice `replacementSkipSeconds`.
 */
export const RECORDING_WAKE_TRIM_SEC = 0.02;

/**
 * Extra earlier shift when the performer synced to software cues
 * (monitor mix and/or metronome) heard through speaker/headphones.
 * Tuned for wired headphones on-device; raise in ~10ms steps if stack
 * harmony / metro takes are still late, lower if early. Bluetooth will
 * need a larger route-specific value later.
 *
 * Folded into `trimIn` (with wake) so activeStart stays on the session
 * start instead of hanging below 0.
 */
export const SOFTWARE_CUE_OUTPUT_COMPENSATION_SEC = 0.1;

export type RecordingLatencyTrimOptions = {
  /** True when AudioContext cues (layers and/or metronome) played during the take. */
  softwareCue?: boolean;
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
  const cueCompensation =
    options?.softwareCue === true
      ? Math.max(0, SOFTWARE_CUE_OUTPUT_COMPENSATION_SEC)
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

  if (__DEV__) {
    const activeStart = layer.startTime + trimIn;
    console.log(
      `[audio] latency trim wake=${wake.toFixed(3)}s ` +
        `cue=${cueCompensation.toFixed(3)}s trimIn=${trimIn.toFixed(3)}s ` +
        `startTime=${layer.startTime.toFixed(3)}s activeStart=${activeStart.toFixed(3)}s`
    );
  }
}
