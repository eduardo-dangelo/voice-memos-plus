import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';

const DURATION_EPSILON = 0.001;

/** Resampled cache keys use `${path}@${contextRate}`. */
export function getResampledCacheKeysForPath(
  path: string,
  cacheKeys: Iterable<string>
): string[] {
  const prefix = `${path}@`;
  const keys: string[] = [];
  for (const key of cacheKeys) {
    if (key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Paths whose on-disk PCM likely changed: same layer id + path, different duration.
 * Does not invalidate on startTime/trim-only changes (effects metadata).
 */
export function layersNeedingBufferInvalidation(
  previous: readonly LoadedLayer[],
  next: readonly LoadedLayer[]
): string[] {
  const previousById = new Map(previous.map((layer) => [layer.id, layer]));
  const paths: string[] = [];

  for (const layer of next) {
    const prior = previousById.get(layer.id);
    if (!prior || prior.path !== layer.path) {
      continue;
    }
    if (Math.abs(prior.duration - layer.duration) > DURATION_EPSILON) {
      paths.push(layer.path);
    }
  }

  return paths;
}
