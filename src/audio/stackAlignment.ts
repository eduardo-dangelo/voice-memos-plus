import { mergeLayerEffects } from '@/src/audio/layerEffects';
import type { Layer, Memo } from '@/src/storage/types';
import {
  clampLayerStartTime,
  getLayerActiveStartTime,
  getLayerEffects,
} from '@/src/storage/types';

/** Leading window used for bleed / metronome alignment. */
export const ALIGN_WINDOW_SEC = 1.5;
/** Search window for residual commit jitter after measured-lead trim. */
export const MAX_SHIFT_SEC = 0.12;
/** Active-start proximity to treat another layer as the stack reference. */
const START_MATCH_EPSILON_SEC = 0.05;
/** Minimum normalized correlation to accept a fine-trim (ducked bleed is weaker). */
const MIN_CORRELATION = 0.38;
/** Ignore tiny shifts (measurement noise). */
const MIN_APPLY_SEC = 0.002;
/** Coarse search stride in samples (refine fills the gaps). */
const COARSE_STRIDE = 8;

export type StackAlignmentResult = {
  deltaTrimSec: number;
  correlation: number;
  referenceLayerId: string;
};

export type StackAlignmentFileOptions = {
  referenceTrimInSec?: number;
  candidateTrimInSec?: number;
};

/**
 * Find another playable layer whose active start matches the new stack point.
 * Prefer the lowest `order` among matches for a stable reference across stacks.
 */
export function findStackAlignmentReference(
  memo: Memo,
  stackedStartTime: number,
  excludeLayerId?: string
): Layer | null {
  let best: Layer | null = null;
  for (const layer of memo.layers) {
    if (layer.id === excludeLayerId || layer.duration <= 0) {
      continue;
    }
    const activeStart = getLayerActiveStartTime(layer);
    const delta = Math.abs(activeStart - stackedStartTime);
    if (delta > START_MATCH_EPSILON_SEC) {
      continue;
    }
    if (
      !best ||
      layer.order < best.order ||
      (layer.order === best.order &&
        delta < Math.abs(getLayerActiveStartTime(best) - stackedStartTime))
    ) {
      best = layer;
    }
  }
  return best;
}

/**
 * Emphasize transients (metronome bleed) before correlation.
 * First-difference high-pass + abs envelope, lightly smoothed.
 */
export function emphasizeTransients(samples: Float32Array): Float32Array {
  const n = samples.length;
  if (n === 0) {
    return samples;
  }
  const out = new Float32Array(n);
  out[0] = Math.abs(samples[0]!);
  for (let i = 1; i < n; i += 1) {
    out[i] = Math.abs(samples[i]! - samples[i - 1]!);
  }
  // 3-tap smooth to stabilize XCorr without blurring ms-scale peaks.
  for (let i = 1; i < n - 1; i += 1) {
    out[i] = (out[i - 1]! + out[i]! + out[i + 1]!) / 3;
  }
  return out;
}

function sliceWindowFromTrim(
  samples: Float32Array,
  sampleRate: number,
  trimInSec: number
): Float32Array {
  const start = Math.max(0, Math.floor(Math.max(0, trimInSec) * sampleRate));
  const count = Math.max(1, Math.floor(ALIGN_WINDOW_SEC * sampleRate));
  if (start >= samples.length) {
    return samples.subarray(0, 0);
  }
  return samples.subarray(start, Math.min(samples.length, start + count));
}

/**
 * Normalized cross-correlation over integer sample lags.
 * Positive lag = candidate energy is late vs reference → increase trimIn.
 */
export function bestSampleCorrelationLag(
  reference: Float32Array,
  candidate: Float32Array,
  maxLagSamples: number,
  stride = 1
): { lagSamples: number; correlation: number } {
  const n = Math.min(reference.length, candidate.length);
  if (n < 64 || maxLagSamples < 1) {
    return { lagSamples: 0, correlation: 0 };
  }

  let refMean = 0;
  let candMean = 0;
  for (let i = 0; i < n; i += 1) {
    refMean += reference[i]!;
    candMean += candidate[i]!;
  }
  refMean /= n;
  candMean /= n;

  let bestLag = 0;
  let bestCorr = -Infinity;
  const step = Math.max(1, Math.floor(stride));

  const scoreLag = (lag: number) => {
    let num = 0;
    let denRef = 0;
    let denCand = 0;
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= n) {
        continue;
      }
      const a = reference[i]! - refMean;
      const b = candidate[j]! - candMean;
      num += a * b;
      denRef += a * a;
      denCand += b * b;
      count += 1;
    }
    if (count < 64 || denRef <= 0 || denCand <= 0) {
      return;
    }
    const corr = num / Math.sqrt(denRef * denCand);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  };

  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag += step) {
    scoreLag(lag);
  }

  // Refine around the coarse peak at every sample.
  if (step > 1 && Number.isFinite(bestCorr) && bestCorr > -Infinity) {
    const refineFrom = Math.max(-maxLagSamples, bestLag - step);
    const refineTo = Math.min(maxLagSamples, bestLag + step);
    for (let lag = refineFrom; lag <= refineTo; lag += 1) {
      scoreLag(lag);
    }
  }

  return {
    lagSamples: bestLag,
    correlation: Number.isFinite(bestCorr) ? bestCorr : 0,
  };
}

/**
 * Sample-accurate lag between two mono PCM buffers (same sample rate).
 * Returns delta trim seconds (positive = trim more from candidate / pull earlier).
 * When trim offsets are provided, correlate from trimIn (post-coarse-trim clicks).
 */
export function estimatePcmAlignmentDeltaSec(
  referenceSamples: Float32Array,
  candidateSamples: Float32Array,
  sampleRate: number,
  options?: { referenceTrimInSec?: number; candidateTrimInSec?: number }
): { deltaTrimSec: number; correlation: number } | null {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    referenceSamples.length < 64 ||
    candidateSamples.length < 64
  ) {
    return null;
  }

  const refTrim = Math.max(0, options?.referenceTrimInSec ?? 0);
  const candTrim = Math.max(0, options?.candidateTrimInSec ?? 0);
  const refWindow = sliceWindowFromTrim(referenceSamples, sampleRate, refTrim);
  const candWindow = sliceWindowFromTrim(candidateSamples, sampleRate, candTrim);
  if (refWindow.length < 64 || candWindow.length < 64) {
    return null;
  }

  const ref = emphasizeTransients(refWindow);
  const cand = emphasizeTransients(candWindow);
  const maxLagSamples = Math.max(1, Math.floor(MAX_SHIFT_SEC * sampleRate));
  const { lagSamples, correlation } = bestSampleCorrelationLag(
    ref,
    cand,
    maxLagSamples,
    COARSE_STRIDE
  );

  if (correlation < MIN_CORRELATION) {
    return null;
  }

  const deltaTrimSec = lagSamples / sampleRate;
  if (Math.abs(deltaTrimSec) < MIN_APPLY_SEC) {
    return null;
  }
  if (Math.abs(deltaTrimSec) > MAX_SHIFT_SEC + 0.001) {
    return null;
  }

  return { deltaTrimSec, correlation };
}

async function loadAlignWindow(
  path: string,
  trimInSec: number
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const windowSec = ALIGN_WINDOW_SEC + MAX_SHIFT_SEC;
  // Dynamic import keeps expo-file-system out of unit-test graph for pure XCorr.
  try {
    const { readWavMonoSamplesWindow } = await import('@/src/audio/wavLeadingRead');
    const partial = await readWavMonoSamplesWindow(path, {
      startSec: Math.max(0, trimInSec),
      maxSec: windowSec,
    });
    if (partial && partial.samples.length >= 64) {
      return partial;
    }
  } catch {
    // Fall through to full decode.
  }

  // Non-WAV / exotic header — fall back to full decode, then slice.
  try {
    const { decodeAudioData } = await import('react-native-audio-api');
    const decoded = await decodeAudioData(path);
    const mono = decoded.getChannelData(0);
    const start = Math.max(0, Math.floor(Math.max(0, trimInSec) * decoded.sampleRate));
    const count = Math.max(1, Math.floor(windowSec * decoded.sampleRate));
    return {
      samples: mono.subarray(start, Math.min(mono.length, start + count)),
      sampleRate: decoded.sampleRate,
    };
  } catch {
    return null;
  }
}

/**
 * Decode leading PCM from two files and estimate a fine-trim delta so the
 * candidate bleed clicks lock to the reference.
 * Prefers a partial WAV read from each layer's trimIn (avoids full-file decode).
 */
export async function estimateStackAlignmentFromFiles(
  referencePath: string,
  candidatePath: string,
  referenceLayerId: string,
  options?: StackAlignmentFileOptions
): Promise<StackAlignmentResult | null> {
  try {
    const refTrim = Math.max(0, options?.referenceTrimInSec ?? 0);
    const candTrim = Math.max(0, options?.candidateTrimInSec ?? 0);
    const [refWindow, candWindow] = await Promise.all([
      loadAlignWindow(referencePath, refTrim),
      loadAlignWindow(candidatePath, candTrim),
    ]);
    if (!refWindow || !candWindow) {
      return null;
    }
    if (Math.abs(refWindow.sampleRate - candWindow.sampleRate) > 1) {
      return null;
    }
    // Windows already start at trimIn — correlate from sample 0.
    const estimate = estimatePcmAlignmentDeltaSec(
      refWindow.samples,
      candWindow.samples,
      refWindow.sampleRate
    );
    if (!estimate) {
      return null;
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(
        `[audio] stack PCM align ref=${referenceLayerId} ` +
          `delta=${(estimate.deltaTrimSec * 1000).toFixed(1)}ms ` +
          `corr=${estimate.correlation.toFixed(3)}`
      );
    }
    return {
      deltaTrimSec: estimate.deltaTrimSec,
      correlation: estimate.correlation,
      referenceLayerId,
    };
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[audio] stack PCM align failed', error);
    }
    return null;
  }
}

/**
 * Apply a fine-trim: fold delta into trimIn and pull startTime so activeStart
 * is preserved (same invariant as applyRecordingIoLatencyTrim).
 */
export function applyStackAlignmentTrimDelta(
  layer: Layer,
  deltaTrimSec: number
): void {
  if (!Number.isFinite(deltaTrimSec) || Math.abs(deltaTrimSec) < MIN_APPLY_SEC) {
    return;
  }
  const effects = getLayerEffects(layer);
  const nextTrimIn = Math.min(
    Math.max(0, effects.trimIn + deltaTrimSec),
    Math.max(0, layer.duration - 0.05)
  );
  const applied = nextTrimIn - effects.trimIn;
  if (Math.abs(applied) < MIN_APPLY_SEC) {
    return;
  }
  layer.effects = mergeLayerEffects(effects, { trimIn: nextTrimIn }, layer.duration);
  layer.startTime = clampLayerStartTime(layer.startTime - applied, nextTrimIn);

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(
      `[audio] stack align delta=${(applied * 1000).toFixed(1)}ms ` +
        `trimIn=${nextTrimIn.toFixed(3)}s startTime=${layer.startTime.toFixed(3)}s`
    );
  }
}
