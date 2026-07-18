import { mergeLayerEffects } from '@/src/audio/layerEffects';
import type { Layer } from '@/src/storage/types';
import { getLayerEffects } from '@/src/storage/types';

/**
 * Typical mic + speaker I/O lag after JS-side atomic record/metro start.
 * Tune here after device testing if takes still sit slightly off the grid.
 */
export const RECORDING_IO_LATENCY_SEC = 0.03;

/** Skip leading I/O lag so the take locks to the metronome on playback. */
export function applyRecordingIoLatencyTrim(layer: Layer): void {
  if (RECORDING_IO_LATENCY_SEC <= 0 || layer.duration <= RECORDING_IO_LATENCY_SEC * 2) {
    return;
  }

  const trimIn = Math.min(
    RECORDING_IO_LATENCY_SEC,
    Math.max(0, layer.duration - 0.05)
  );
  if (trimIn <= 0.001) {
    return;
  }

  const effects = getLayerEffects(layer);
  layer.effects = mergeLayerEffects(effects, { trimIn }, layer.duration);

  if (__DEV__) {
    console.log(
      `[audio] applied recording I/O latency trimIn=${trimIn.toFixed(3)}s`
    );
  }
}
