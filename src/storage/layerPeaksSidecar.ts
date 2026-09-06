import { Directory, File } from 'expo-file-system';

/**
 * Peak sidecars keep design-density waveform arrays out of pretty-printed
 * manifest.json (DAW-style: overview data separate from project metadata).
 */

function peaksFileName(layerId: string): string {
  return `${layerId}.peaks.json`;
}

export function getLayerPeaksDir(memoDir: Directory): Directory {
  return new Directory(memoDir, 'peaks');
}

export function writeLayerPeaksSidecar(
  memoDir: Directory,
  layerId: string,
  peaks: number[]
): void {
  if (!layerId || peaks.length === 0) {
    return;
  }
  const dir = getLayerPeaksDir(memoDir);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const file = new File(dir, peaksFileName(layerId));
  if (!file.exists) {
    file.create();
  }
  // Compact JSON (no pretty-print) — peaks are dense numeric arrays.
  file.write(JSON.stringify(peaks));
}

export function readLayerPeaksSidecar(
  memoDir: Directory,
  layerId: string
): number[] | undefined {
  if (!layerId) {
    return undefined;
  }
  try {
    const file = new File(getLayerPeaksDir(memoDir), peaksFileName(layerId));
    if (!file.exists) {
      return undefined;
    }
    const raw = new TextDecoder().decode(file.bytesSync());
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }
    return parsed.map((value) => Number(value) || 0);
  } catch {
    return undefined;
  }
}

export function deleteLayerPeaksSidecar(memoDir: Directory, layerId: string): void {
  try {
    const file = new File(getLayerPeaksDir(memoDir), peaksFileName(layerId));
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort.
  }
}

/** Strip peaks from a memo clone used only for manifest serialization. */
export function memoForManifestWrite<T extends { layers: { waveformPeaks?: number[] }[] }>(
  memo: T
): T {
  return {
    ...memo,
    layers: memo.layers.map((layer) => {
      const { waveformPeaks: _omit, ...rest } = layer;
      return rest;
    }),
  } as T;
}
