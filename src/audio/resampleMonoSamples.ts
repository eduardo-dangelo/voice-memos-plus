/**
 * Sync linear resample for short mono windows (e.g. 16s PCM pages).
 * Keep inputs short — no yield. Full-stem work uses wavUtils async helpers.
 */
export function resampleMonoSamplesFromRate(
  samples: Float32Array,
  fromRate: number,
  targetRate: number
): Float32Array {
  const roundedFrom = Math.round(fromRate);
  const roundedTarget = Math.round(targetRate);
  if (roundedFrom === roundedTarget) {
    return samples;
  }

  const outLength = Math.max(
    1,
    Math.round((samples.length * roundedTarget) / roundedFrom)
  );
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = (i * roundedFrom) / roundedTarget;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const a = samples[idx] ?? 0;
    const b = samples[Math.min(idx + 1, samples.length - 1)] ?? 0;
    out[i] = a + frac * (b - a);
  }
  return out;
}
