/** Length-preserving edge fade at splice joints (~10 ms). */
export const SPLICE_EDGE_FADE_SECONDS = 0.01;

/**
 * Fade out the end of each part and fade in the start of the next.
 * Does not overlap/remove samples — total length stays sum(parts).
 */
export function applySpliceEdgeFades(
  parts: Float32Array[],
  sampleRate: number,
  fadeSeconds = SPLICE_EDGE_FADE_SECONDS
): Float32Array[] {
  if (parts.length < 2 || sampleRate <= 0 || fadeSeconds <= 0) {
    return parts;
  }

  const fadeSamples = Math.max(0, Math.round(fadeSeconds * sampleRate));
  if (fadeSamples <= 0) {
    return parts;
  }

  const out = parts.map((part) => new Float32Array(part));
  for (let i = 0; i < out.length - 1; i++) {
    const left = out[i]!;
    const right = out[i + 1]!;
    const n = Math.min(fadeSamples, left.length, right.length);
    if (n <= 0) {
      continue;
    }
    for (let s = 0; s < n; s++) {
      const t = (s + 1) / (n + 1);
      // Equal-power edge fades (length-preserving).
      const fadeOut = Math.cos(t * (Math.PI / 2));
      const fadeIn = Math.sin(t * (Math.PI / 2));
      const leftIndex = left.length - n + s;
      left[leftIndex] = (left[leftIndex] ?? 0) * fadeOut;
      right[s] = (right[s] ?? 0) * fadeIn;
    }
  }
  return out;
}
