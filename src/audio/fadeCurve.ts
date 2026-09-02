import type { LayerEffectPathNodes } from '@/src/audio/layerEffectChain';
import type { LayerEffects } from '@/src/audio/layerEffects';

/** Bipolar Logic-style fade curve: −1…1, 0 = linear. */
export const FADE_CURVE_MIN = -1;
export const FADE_CURVE_MAX = 1;
export const FADE_CURVE_SAMPLES = 64;
/** Minimum non-zero fade length (seconds) when dragging from a zero edge. */
export const MIN_FADE_SEC = 0.02;

export type FadeDirection = 'in' | 'out';

export function clampFadeCurve(curve: number): number {
  if (!Number.isFinite(curve)) {
    return 0;
  }
  return Math.max(FADE_CURVE_MIN, Math.min(FADE_CURVE_MAX, curve));
}

/**
 * Shape progress t∈[0,1] with a power curve.
 * Positive curve → faster start (concave-down for fade-in).
 * Negative curve → slower start (concave-up for fade-in).
 */
export function shapeFadeProgress(t: number, curve: number): number {
  const clampedT = Math.max(0, Math.min(1, t));
  const clampedCurve = clampFadeCurve(curve);
  if (clampedT <= 0) {
    return 0;
  }
  if (clampedT >= 1) {
    return 1;
  }
  const exponent = Math.pow(2, -clampedCurve * 2);
  return Math.pow(clampedT, exponent);
}

/** Linear gain 0…1 for fade-in/out at normalized progress through the fade. */
export function fadeGainAt(t: number, curve: number, direction: FadeDirection): number {
  const shaped = shapeFadeProgress(t, curve);
  return direction === 'in' ? shaped : 1 - shaped;
}

/** Sample a fade gain curve for AudioParam.setValueCurveAtTime / SVG drawing. */
export function sampleFadeCurve(
  curve: number,
  direction: FadeDirection,
  sampleCount: number = FADE_CURVE_SAMPLES
): Float32Array {
  const count = Math.max(2, Math.floor(sampleCount));
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    values[i] = fadeGainAt(i / (count - 1), curve, direction);
  }
  // Avoid exact 0 for exponential-adjacent APIs; setValueCurve allows 0.
  return values;
}

export type ClampFadeResult = {
  fadeInSec: number;
  fadeOutSec: number;
  fadeInCurve: number;
  fadeOutCurve: number;
};

export function clampFadeValues(
  fadeInSec: number,
  fadeOutSec: number,
  fadeInCurve: number,
  fadeOutCurve: number,
  activeDuration: number
): ClampFadeResult {
  const duration = Math.max(0, activeDuration);
  let nextIn = Math.max(0, Number.isFinite(fadeInSec) ? fadeInSec : 0);
  let nextOut = Math.max(0, Number.isFinite(fadeOutSec) ? fadeOutSec : 0);

  if (duration <= 0) {
    return {
      fadeInSec: 0,
      fadeOutSec: 0,
      fadeInCurve: clampFadeCurve(fadeInCurve),
      fadeOutCurve: clampFadeCurve(fadeOutCurve),
    };
  }

  if (nextIn + nextOut > duration) {
    const total = nextIn + nextOut;
    if (total > 0) {
      nextIn = (nextIn / total) * duration;
      nextOut = (nextOut / total) * duration;
    } else {
      nextIn = 0;
      nextOut = 0;
    }
  }

  // Snap tiny accidental fades to zero.
  if (nextIn < MIN_FADE_SEC / 2) {
    nextIn = 0;
  }
  if (nextOut < MIN_FADE_SEC / 2) {
    nextOut = 0;
  }

  return {
    fadeInSec: nextIn,
    fadeOutSec: nextOut,
    fadeInCurve: clampFadeCurve(fadeInCurve),
    fadeOutCurve: clampFadeCurve(fadeOutCurve),
  };
}

export type ScheduleLayerFadesOptions = {
  startWhen: number;
  playLength: number;
  /** Position within the active region (trimOut−trimIn) where this schedule begins. */
  activeOffset: number;
  activeDuration: number;
  fadeInSec: number;
  fadeOutSec: number;
  fadeInCurve: number;
  fadeOutCurve: number;
};

type AudioParamLike = {
  cancelScheduledValues: (time: number) => void;
  cancelAndHoldAtTime?: (time: number) => void;
  setValueAtTime: (value: number, time: number) => unknown;
  setValueCurveAtTime: (values: Float32Array, startTime: number, duration: number) => unknown;
};

const FADE_EVENT_EPSILON = 1e-4;

function safeSetValueAtTime(param: AudioParamLike, value: number, time: number): void {
  try {
    param.setValueAtTime(value, time);
  } catch {
    // Ignore conflicts; caller may have already set a curve covering this time.
  }
}

/**
 * Clear prior automation that could overlap `startWhen`.
 * `cancelScheduledValues(t)` only removes events with start ≥ t, so a curve that
 * began earlier and still spans `startWhen` survives — clear from 0 instead.
 */
function clearFadeAutomation(param: AudioParamLike, startWhen: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    try {
      param.cancelAndHoldAtTime(startWhen);
    } catch {
      // Fall through to full cancel.
    }
  }
  // Always cancel from 0 so leftover setValueCurveAtTime ranges cannot overlap.
  param.cancelScheduledValues(0);
}

/**
 * Schedule fade-in/out automation on a dedicated fade GainNode.
 * Peak gain is always 1; volume lives on a separate upstream gain.
 */
export function scheduleLayerFades(param: AudioParamLike, options: ScheduleLayerFadesOptions): void {
  const {
    startWhen,
    playLength,
    activeOffset,
    activeDuration,
    fadeInSec,
    fadeOutSec,
    fadeInCurve,
    fadeOutCurve,
  } = options;

  const safePlayLength = Math.max(0, playLength);
  const stopWhen = startWhen + safePlayLength;
  const clamped = clampFadeValues(
    fadeInSec,
    fadeOutSec,
    fadeInCurve,
    fadeOutCurve,
    activeDuration
  );

  clearFadeAutomation(param, startWhen);

  if (safePlayLength <= 0) {
    safeSetValueAtTime(param, 0, startWhen);
    return;
  }

  if (clamped.fadeInSec <= 0 && clamped.fadeOutSec <= 0) {
    safeSetValueAtTime(param, 1, startWhen);
    return;
  }

  const fadeOutStartActive = Math.max(0, activeDuration - clamped.fadeOutSec);
  const endActive = activeOffset + safePlayLength;

  // Initial gain at schedule start.
  let startGain = 1;
  if (clamped.fadeInSec > 0 && activeOffset < clamped.fadeInSec) {
    startGain = fadeGainAt(activeOffset / clamped.fadeInSec, clamped.fadeInCurve, 'in');
  } else if (clamped.fadeOutSec > 0 && activeOffset >= fadeOutStartActive) {
    const t = (activeOffset - fadeOutStartActive) / clamped.fadeOutSec;
    startGain = fadeGainAt(t, clamped.fadeOutCurve, 'out');
  }

  const willScheduleFadeInCurve =
    clamped.fadeInSec > 0 &&
    activeOffset < clamped.fadeInSec &&
    Math.min(clamped.fadeInSec - activeOffset, safePlayLength) > 0;

  // Fade-out window in audio time (needed before hold-at-1 to avoid overlaps).
  let fadeOutAudioStart = Number.POSITIVE_INFINITY;
  let fadeOutDuration = 0;
  if (clamped.fadeOutSec > 0 && endActive > fadeOutStartActive && activeOffset < activeDuration) {
    fadeOutAudioStart = startWhen + Math.max(0, fadeOutStartActive - activeOffset);
    const fadeOutAudioEnd = Math.min(
      stopWhen,
      startWhen + Math.max(0, activeDuration - activeOffset)
    );
    fadeOutDuration = fadeOutAudioEnd - fadeOutAudioStart;
    if (!(fadeOutDuration > FADE_EVENT_EPSILON && fadeOutAudioStart < stopWhen)) {
      fadeOutAudioStart = Number.POSITIVE_INFINITY;
      fadeOutDuration = 0;
    }
  }

  // Remaining fade-in. Curve's first sample is startGain — do not also setValueAtTime
  // at the same instant (conflicts on some engines).
  if (willScheduleFadeInCurve) {
    const remainingIn = clamped.fadeInSec - activeOffset;
    const curveDuration = Math.min(remainingIn, safePlayLength);
    const startT = activeOffset / clamped.fadeInSec;
    const endT = Math.min(1, (activeOffset + curveDuration) / clamped.fadeInSec);
    const samples = sampleFadeSegment(clamped.fadeInCurve, 'in', startT, endT);
    try {
      param.setValueCurveAtTime(samples, startWhen, curveDuration);
    } catch {
      safeSetValueAtTime(
        param,
        fadeGainAt(endT, clamped.fadeInCurve, 'in'),
        startWhen + curveDuration
      );
    }
    const holdAt = startWhen + curveDuration + FADE_EVENT_EPSILON;
    const fadeOutCoversHold =
      fadeOutDuration > 0 &&
      holdAt >= fadeOutAudioStart - FADE_EVENT_EPSILON &&
      holdAt <= fadeOutAudioStart + fadeOutDuration + FADE_EVENT_EPSILON;
    if (endT >= 1 && holdAt < stopWhen - FADE_EVENT_EPSILON && !fadeOutCoversHold) {
      safeSetValueAtTime(param, 1, holdAt);
    }
  } else {
    safeSetValueAtTime(param, startGain, startWhen);
  }

  // Fade-out overlapping this schedule window.
  if (fadeOutDuration > 0) {
    const startT = Math.max(
      0,
      Math.min(1, (Math.max(activeOffset, fadeOutStartActive) - fadeOutStartActive) / clamped.fadeOutSec)
    );
    const endT = Math.max(
      startT,
      Math.min(1, (Math.min(endActive, activeDuration) - fadeOutStartActive) / clamped.fadeOutSec)
    );
    const samples = sampleFadeSegment(clamped.fadeOutCurve, 'out', startT, endT);
    try {
      param.setValueCurveAtTime(samples, fadeOutAudioStart, fadeOutDuration);
    } catch {
      safeSetValueAtTime(
        param,
        fadeGainAt(endT, clamped.fadeOutCurve, 'out'),
        fadeOutAudioStart + fadeOutDuration
      );
    }
  }
}

function sampleFadeSegment(
  curve: number,
  direction: FadeDirection,
  startT: number,
  endT: number,
  sampleCount: number = FADE_CURVE_SAMPLES
): Float32Array {
  const count = Math.max(2, Math.floor(sampleCount));
  const values = new Float32Array(count);
  const span = Math.max(0, endT - startT);
  for (let i = 0; i < count; i += 1) {
    const t = startT + (span * i) / (count - 1);
    values[i] = fadeGainAt(t, curve, direction);
  }
  return values;
}

/** Schedule fades on a mix path from layer effects + buffer offset. */
export function schedulePathFades(
  path: LayerEffectPathNodes,
  effects: LayerEffects,
  startWhen: number,
  playLength: number,
  bufferOffset: number,
  envelopeOverPlayLength = false
): void {
  if (envelopeOverPlayLength) {
    scheduleLayerFades(path.fadeGain.gain, {
      startWhen,
      playLength,
      activeOffset: 0,
      activeDuration: playLength,
      fadeInSec: effects.fadeInSec,
      fadeOutSec: effects.fadeOutSec,
      fadeInCurve: effects.fadeInCurve,
      fadeOutCurve: effects.fadeOutCurve,
    });
    return;
  }
  const activeDuration = Math.max(0, effects.trimOut - effects.trimIn);
  const activeOffset = Math.max(0, bufferOffset - effects.trimIn);
  scheduleLayerFades(path.fadeGain.gain, {
    startWhen,
    playLength,
    activeOffset,
    activeDuration,
    fadeInSec: effects.fadeInSec,
    fadeOutSec: effects.fadeOutSec,
    fadeInCurve: effects.fadeInCurve,
    fadeOutCurve: effects.fadeOutCurve,
  });
}

/**
 * Build an SVG path for the attenuated (top) side of a fade wedge.
 * Fills above the gain curve down from y=0.
 */
export function buildFadeSvgPath(
  width: number,
  height: number,
  curve: number,
  direction: FadeDirection,
  sampleCount: number = 32
): string {
  if (width <= 0 || height <= 0) {
    return '';
  }
  const count = Math.max(2, sampleCount);
  const curvePoints: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const gain = fadeGainAt(t, curve, direction);
    const x = t * width;
    const y = height * (1 - gain);
    curvePoints.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M0,0 ${curvePoints.join(' ')} L${width.toFixed(2)},0 Z`;
}

/** Envelope gain (0…1) at a time within an active-region clip of `duration` seconds. */
export function fadeEnvelopeGain(
  barTime: number,
  duration: number,
  fades: {
    fadeInSec: number;
    fadeOutSec: number;
    fadeInCurve: number;
    fadeOutCurve: number;
  }
): number {
  if (duration <= 0) {
    return 1;
  }
  const t = Math.max(0, Math.min(duration, barTime));
  let gain = 1;
  if (fades.fadeInSec > 0 && t < fades.fadeInSec) {
    gain = Math.min(gain, fadeGainAt(t / fades.fadeInSec, fades.fadeInCurve, 'in'));
  }
  if (fades.fadeOutSec > 0 && t > duration - fades.fadeOutSec) {
    const outT = (t - (duration - fades.fadeOutSec)) / fades.fadeOutSec;
    gain = Math.min(gain, fadeGainAt(outT, fades.fadeOutCurve, 'out'));
  }
  return gain;
}
