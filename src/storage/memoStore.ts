import { Directory, File, Paths } from 'expo-file-system';

import { computeWaveformPeaks, peakCountForDuration, resolveWaveformPeaks } from '@/src/audio/waveform';
import {
  createDefaultLayerEffects,
  isDefaultTrim,
  mergeLayerEffects,
  type LayerEffects,
  type LayerEffectsChange,
} from '@/src/audio/layerEffects';
import { mixLayersToFile, spliceRecording } from '@/src/audio/wavUtils';
import { createDefaultTitle } from '@/src/utils/format';
import { randomId } from '@/src/utils/id';

import {
  getLayerFile,
  getManifestFile,
  getMemoDir,
  getMemosRoot,
  getPrimaryLayerFile,
} from './paths';
import type { Layer, Memo } from './types';
import {
  getLayerEffects,
  getMemoTimelineDuration,
  normalizeLayers,
  normalizeLoopRegion,
  getEarliestTrimInTimelineDelta,
} from './types';

function createLayer(order: number, startTime = 0): Layer {
  return {
    id: randomId(),
    order,
    fileName: `layer-${order}.m4a`,
    label: `Layer ${order + 1}`,
    startTime,
    duration: 0,
  };
}

function readManifest(file: File): Memo | null {
  if (!file.exists) {
    return null;
  }
  try {
    const memo = normalizeLayers(JSON.parse(file.textSync()) as Memo);
    const previousDuration = memo.duration;
    const timeline = getMemoTimelineDuration(memo);
    memo.duration = timeline;
    syncTrimEndToTimeline(memo, previousDuration, timeline);
    if (memo.trimEnd === 0 && timeline > 0) {
      memo.trimEnd = timeline;
    }
    if (memo.trimEnd > 0 && memo.trimEnd < timeline) {
      memo.trimEnd = timeline;
    }
    normalizeLoopRegion(memo, timeline);
    return memo;
  } catch {
    return null;
  }
}

function writeManifest(memo: Memo): void {
  const file = getManifestFile(memo.id);
  const dir = getMemoDir(memo.id);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  if (!file.exists) {
    file.create();
  }
  file.write(JSON.stringify(memo, null, 2));
}

function syncTrimEndToTimeline(memo: Memo, previousDuration: number, timeline: number): void {
  if (memo.trimEnd === 0) {
    memo.trimEnd = timeline;
    return;
  }

  if (memo.trimEnd > timeline) {
    memo.trimEnd = timeline;
    return;
  }

  const trimWasAtPreviousEnd = memo.trimEnd >= previousDuration - 0.05;
  if (timeline > previousDuration && trimWasAtPreviousEnd) {
    memo.trimEnd = timeline;
  }
}

function updateMemoTimeline(memo: Memo): void {
  const previousDuration = memo.duration;
  const timeline = getMemoTimelineDuration(memo);
  memo.duration = timeline;
  syncTrimEndToTimeline(memo, previousDuration, timeline);
}

async function refreshLayerFromFile(
  memo: Memo,
  layer: Layer,
  capturedPeaks?: number[]
): Promise<void> {
  const file = getLayerFile(memo.id, layer.fileName);
  const { decodeAudioData } = await import('react-native-audio-api');
  const buffer = await decodeAudioData(file.uri);
  layer.duration = buffer.duration;
  layer.waveformPeaks = await resolveWaveformPeaks(
    file.uri,
    buffer.duration,
    capturedPeaks
  );
  layer.effects = createDefaultLayerEffects(layer.duration);
}

export async function listMemos(): Promise<Memo[]> {
  const root = getMemosRoot();
  const entries = root.list();
  const memos: Memo[] = [];

  for (const entry of entries) {
    if (!(entry instanceof Directory)) {
      continue;
    }
    const manifest = readManifest(new File(entry, 'manifest.json'));
    if (manifest) {
      memos.push(manifest);
    }
  }

  return memos.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getMemo(memoId: string): Promise<Memo | null> {
  return readManifest(getManifestFile(memoId));
}

export async function createMemo(title?: string): Promise<Memo> {
  const now = new Date().toISOString();
  const memo: Memo = {
    id: randomId(),
    title: title ?? createDefaultTitle(),
    createdAt: now,
    updatedAt: now,
    duration: 0,
    trimStart: 0,
    trimEnd: 0,
    layers: [createLayer(0)],
  };

  const dir = getMemoDir(memo.id);
  dir.create({ intermediates: true, idempotent: true });
  writeManifest(memo);
  return memo;
}

export async function updateTitle(memoId: string, title: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.title = title.trim() || memo.title;
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLoopRegion(
  memoId: string,
  loopStart: number,
  loopEnd: number,
  loopEnabled: boolean
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.loopStart = loopStart;
  memo.loopEnd = loopEnd;
  memo.loopEnabled = loopEnabled;
  normalizeLoopRegion(memo, getMemoTimelineDuration(memo));
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function deactivateMemoLoop(memoId: string): Promise<Memo | null> {
  const memo = await getMemo(memoId);
  if (!memo || !memo.loopEnabled) {
    return memo;
  }
  return updateLoopRegion(memoId, memo.loopStart ?? 0, memo.loopEnd ?? 0, false);
}

export async function updateTrim(
  memoId: string,
  trimStart: number,
  trimEnd: number
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.trimStart = Math.max(0, trimStart);
  memo.trimEnd = Math.min(memo.duration, trimEnd);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLayerEffects(
  memoId: string,
  layerId: string,
  partial: LayerEffectsChange
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const current = getLayerEffects(layer);
  layer.effects = mergeLayerEffects(current, partial, layer.duration);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLayerStartTimes(
  memoId: string,
  updates: Record<string, number>
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  for (const entry of memo.layers) {
    const nextStartTime = updates[entry.id];
    if (nextStartTime !== undefined) {
      entry.startTime = nextStartTime;
    }
  }

  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLayerStartTime(
  memoId: string,
  layerId: string,
  startTime: number
): Promise<Memo> {
  return updateLayerStartTimes(memoId, { [layerId]: startTime });
}

export type TrimBounds = {
  trimIn: number;
  trimOut: number;
  preservedEffects?: Pick<LayerEffects, 'volumeDb' | 'reverb' | 'delay' | 'eq'>;
};

export async function commitLayerTrim(
  memoId: string,
  layerId: string,
  bounds: TrimBounds
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const layerFile = getLayerFile(memoId, layer.fileName);
  if (!layerFile.exists) {
    throw new Error('Layer audio file not found');
  }

  const trimEffects: Pick<LayerEffects, 'trimIn' | 'trimOut'> = {
    trimIn: bounds.trimIn,
    trimOut: bounds.trimOut,
  };

  if (isDefaultTrim({ ...getLayerEffects(layer), ...trimEffects }, layer.duration)) {
    return memo;
  }

  const effects = getLayerEffects(layer);
  const preservedEffects = bounds.preservedEffects ?? {
    volumeDb: effects.volumeDb,
    reverb: { ...effects.reverb },
    delay: { ...effects.delay },
    eq: { preset: effects.eq.preset, bands: [...effects.eq.bands] as LayerEffects['eq']['bands'] },
  };

  const timelineDelta = getEarliestTrimInTimelineDelta(layer, memo.layers, bounds.trimIn);

  layer.effects = mergeLayerEffects(
    getLayerEffects(layer),
    {
      ...preservedEffects,
      trimIn: bounds.trimIn,
      trimOut: bounds.trimOut,
    },
    layer.duration
  );

  if (timelineDelta !== 0) {
    for (const entry of memo.layers) {
      entry.startTime += timelineDelta;
    }
  }

  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

/** @deprecated Use commitLayerTrim — trim save is non-destructive. */
export const applyLayerTrim = commitLayerTrim;

export async function ensureWaveformPeaks(memo: Memo): Promise<Memo> {
  let changed = false;

  for (const layer of memo.layers) {
    if (layer.duration <= 0) {
      continue;
    }

    const file = getLayerFile(memo.id, layer.fileName);
    if (!file.exists) {
      continue;
    }

    try {
      const nextPeaks = await computeWaveformPeaks(
        file.uri,
        peakCountForDuration(layer.duration)
      );
      const prevPeaks = layer.waveformPeaks;
      const peaksChanged =
        !prevPeaks ||
        prevPeaks.length !== nextPeaks.length ||
        prevPeaks.some((peak, index) => peak !== nextPeaks[index]);
      if (peaksChanged) {
        layer.waveformPeaks = nextPeaks;
        changed = true;
      }
    } catch {
      // Leave peaks unset; UI falls back to placeholder bars.
    }
  }

  if (changed) {
    memo.updatedAt = new Date().toISOString();
    writeManifest(memo);
  }

  return memo;
}

export async function saveRecording(
  memoId: string,
  sourcePath: string,
  _duration: number,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers[0] ?? createLayer(0);
  memo.layers = [layer];
  layer.startTime = 0;
  const dest = getLayerFile(memoId, layer.fileName);
  const source = new File(sourcePath);

  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  await refreshLayerFromFile(memo, layer, capturedPeaks);
  memo.trimStart = 0;
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();

  writeManifest(memo);
  return memo;
}

export async function replaceLayerFile(
  memoId: string,
  layerId: string,
  sourcePath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const dest = getLayerFile(memoId, layer.fileName);
  const source = new File(sourcePath);

  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  await refreshLayerFromFile(memo, layer, capturedPeaks);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();

  writeManifest(memo);
  return memo;
}

export async function addStackedLayer(
  memoId: string,
  startTime: number,
  sourcePath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const order = memo.layers.length;
  const layer = createLayer(order, startTime);
  const dest = getLayerFile(memoId, layer.fileName);
  const source = new File(sourcePath);

  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  await refreshLayerFromFile(memo, layer, capturedPeaks);
  memo.layers.push(layer);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function replaceLayerSegment(
  memoId: string,
  layerId: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const original = getLayerFile(memoId, layer.fileName);
  const output = new File(Paths.cache, `splice-${memoId}-${layerId}.m4a`);

  if (output.exists) {
    output.delete();
  }

  await spliceRecording(original.uri, trimStart, trimEnd, replacementPath, output.uri);
  await replaceLayerFile(memoId, layerId, output.uri, capturedPeaks);
  return (await getMemo(memoId))!;
}

export async function deleteMemo(memoId: string): Promise<void> {
  const dir = getMemoDir(memoId);
  if (dir.exists) {
    dir.delete();
  }
}

export async function duplicateMemo(memoId: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const copy = await createMemo(`${memo.title} copy`);
  const sourceDir = getMemoDir(memoId);
  const destDir = getMemoDir(copy.id);

  for (const entry of sourceDir.list()) {
    if (entry instanceof File) {
      entry.copy(new File(destDir, entry.name));
    }
  }

  const updated: Memo = {
    ...memo,
    id: copy.id,
    title: copy.title,
    createdAt: copy.createdAt,
    updatedAt: new Date().toISOString(),
  };
  writeManifest(updated);
  return updated;
}

export async function replaceRecordingSegment(
  memoId: string,
  layerId: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  return replaceLayerSegment(
    memoId,
    layerId,
    trimStart,
    trimEnd,
    replacementPath,
    capturedPeaks
  );
}

export async function getShareableFile(memo: Memo): Promise<File> {
  const playableLayers = memo.layers.filter((layer) => layer.duration > 0);
  if (playableLayers.length <= 1) {
    return getPrimaryLayerFile(memo);
  }

  const output = new File(Paths.cache, `mix-${memo.id}.m4a`);
  if (output.exists) {
    output.delete();
  }

  await mixLayersToFile(
    playableLayers.map((layer) => ({
      path: getLayerFile(memo.id, layer.fileName).uri,
      startTime: layer.startTime,
    })),
    getMemoTimelineDuration(memo),
    output.uri
  );

  return output;
}
