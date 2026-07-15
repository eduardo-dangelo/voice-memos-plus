import { Directory, File, Paths } from 'expo-file-system';

import { computeWaveformPeaks, peakCountForDuration, resolveWaveformPeaks } from '@/src/audio/waveform';
import {
  createDefaultLayerEffects,
  isDefaultTrim,
  mergeLayerEffects,
  type LayerEffects,
  type LayerEffectsChange,
} from '@/src/audio/layerEffects';
import { renderMemoForShare } from '@/src/audio/memoExport';
import { spliceRecording, writeAudioBufferToWavFile } from '@/src/audio/wavUtils';
import { encodeWavToM4a } from 'audio-encode';
import {
  DEFAULT_TRACK_COLOR,
  isTrackColorAllowed,
  pickRandomTrackColor,
} from '@/constants/VoiceMemosColors';
import { createDefaultTitle, sanitizeExportFileName } from '@/src/utils/format';
import { randomId } from '@/src/utils/id';

import {
  getManifestFile,
  getMemoDir,
  getMemosRoot,
  getTrashMemoDir,
  getTrashMemosRoot,
  moveMemoDirectory,
  requireLayerFile,
  resolveMemoDir,
} from './paths';
import type { Layer, Memo, MetronomeSettings } from './types';
import {
  getDefaultLayerLabel,
  getLayerEffects,
  getMemoMetronomeSettings,
  getMemoTimelineDuration,
  getPlayableLayers,
  normalizeLayers,
  normalizeLoopRegion,
  normalizeMetronomeSettings,
  getEarliestTrimInTimelineDelta,
  hasRecording,
} from './types';

export type ExportFormat = 'm4a' | 'wav';

function alignLayerFileNameWithSource(layer: Layer, sourcePath: string): void {
  const sourceIsWav = sourcePath.toLowerCase().endsWith('.wav');
  if (sourceIsWav && layer.fileName.endsWith('.m4a')) {
    layer.fileName = layer.fileName.replace(/\.m4a$/, '.wav');
  } else if (!sourceIsWav && layer.fileName.endsWith('.wav')) {
    layer.fileName = layer.fileName.replace(/\.wav$/, '.m4a');
  }
}

function createLayer(
  order: number,
  startTime = 0,
  usedColors: readonly string[] = []
): Layer {
  return {
    id: randomId(),
    order,
    fileName: `layer-${order}.m4a`,
    label: getDefaultLayerLabel(order),
    color:
      usedColors.length === 0
        ? DEFAULT_TRACK_COLOR
        : pickRandomTrackColor(usedColors),
    startTime,
    duration: 0,
  };
}

/** Assigns colors to layers that are missing one. Returns true if any were assigned. */
function ensureLayerColors(memo: Memo): boolean {
  let changed = false;
  const used: string[] = [];
  for (const layer of memo.layers) {
    if (layer.color && isTrackColorAllowed(layer.color)) {
      used.push(layer.color);
      continue;
    }
    layer.color =
      used.length === 0 ? DEFAULT_TRACK_COLOR : pickRandomTrackColor(used);
    used.push(layer.color);
    changed = true;
  }
  return changed;
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
  const dir = resolveMemoDir(memo.id) ?? getMemoDir(memo.id);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const file = new File(dir, 'manifest.json');
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
  const file = requireLayerFile(memo.id, layer.fileName);
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

export type MemoListScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'trash' };

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function listMemosFromRoot(root: Directory): Memo[] {
  const memos: Memo[] = [];
  for (const entry of root.list()) {
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

export async function listMemos(scope: MemoListScope = { kind: 'all' }): Promise<Memo[]> {
  if (scope.kind === 'trash') {
    return listMemosFromRoot(getTrashMemosRoot());
  }

  const memos = listMemosFromRoot(getMemosRoot());
  if (scope.kind === 'folder') {
    return memos.filter((memo) => memo.folderId === scope.folderId);
  }
  return memos;
}

export async function listAllActiveMemos(): Promise<Memo[]> {
  return listMemosFromRoot(getMemosRoot());
}

export async function listTrashMemos(): Promise<Memo[]> {
  return listMemosFromRoot(getTrashMemosRoot());
}

export async function getMemo(memoId: string): Promise<Memo | null> {
  const file = getManifestFile(memoId);
  if (!file) {
    return null;
  }
  const memo = readManifest(file);
  if (memo && ensureLayerColors(memo)) {
    writeManifest(memo);
  }
  return memo;
}

export type CreateMemoOptions = {
  title?: string;
  folderId?: string;
  titleSource?: Memo['titleSource'];
};

export async function createMemo(options?: CreateMemoOptions | string): Promise<Memo> {
  const normalized =
    typeof options === 'string' ? { title: options } : (options ?? {});
  const now = new Date().toISOString();
  const memo: Memo = {
    id: randomId(),
    title: normalized.title ?? createDefaultTitle(),
    createdAt: now,
    updatedAt: now,
    duration: 0,
    trimStart: 0,
    trimEnd: 0,
    layers: [createLayer(0)],
  };
  if (normalized.folderId) {
    memo.folderId = normalized.folderId;
  }
  if (normalized.titleSource) {
    memo.titleSource = normalized.titleSource;
  }

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
  memo.titleSource = 'user';
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLocationTitle(memoId: string, title: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  if (memo.titleSource === 'user') {
    return memo;
  }
  memo.title = title.trim() || memo.title;
  memo.titleSource = 'location';
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLayerLabel(
  memoId: string,
  layerId: string,
  label: string
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error('Label cannot be empty');
  }

  layer.label = trimmed;
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateLayerColor(
  memoId: string,
  layerId: string,
  color: string
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  if (!isTrackColorAllowed(color)) {
    throw new Error('Invalid track color');
  }

  layer.color = color === DEFAULT_TRACK_COLOR ? undefined : color;
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

export async function updateMetronomeSettings(
  memoId: string,
  partial: Partial<MetronomeSettings>
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.metronome = normalizeMetronomeSettings({
    ...getMemoMetronomeSettings(memo),
    ...partial,
  });
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
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

  const layerFile = requireLayerFile(memoId, layer.fileName);
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

    const file = requireLayerFile(memo.id, layer.fileName);
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
  alignLayerFileNameWithSource(layer, sourcePath);
  const dest = requireLayerFile(memoId, layer.fileName);
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

  const source = new File(sourcePath);
  const previousFileName = layer.fileName;
  alignLayerFileNameWithSource(layer, sourcePath);

  if (previousFileName !== layer.fileName) {
    const oldFile = requireLayerFile(memoId, previousFileName);
    if (oldFile.exists) {
      oldFile.delete();
    }
  }

  const dest = requireLayerFile(memoId, layer.fileName);

  if (dest.exists) {
    dest.delete();
  }
  await source.copy(dest);

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
  capturedPeaks?: number[],
  color?: string
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const order = memo.layers.length;
  const usedColors = memo.layers.map(
    (entry) => entry.color ?? DEFAULT_TRACK_COLOR
  );
  const layer = createLayer(order, startTime, usedColors);
  if (color && isTrackColorAllowed(color)) {
    layer.color = color;
  }
  alignLayerFileNameWithSource(layer, sourcePath);
  const dest = requireLayerFile(memoId, layer.fileName);
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
  capturedPeaks?: number[],
  leadingPadSeconds = 0
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const original = requireLayerFile(memoId, layer.fileName);
  const output = new File(Paths.cache, `splice-${memoId}-${layerId}.wav`);

  if (output.exists) {
    output.delete();
  }

  await spliceRecording(original.uri, trimStart, trimEnd, replacementPath, output.uri, {
    leadingPadSeconds,
  });
  await replaceLayerFile(memoId, layerId, output.uri, capturedPeaks);
  return (await getMemo(memoId))!;
}

export async function moveMemoToFolder(
  memoId: string,
  folderId: string | null
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  if (folderId) {
    memo.folderId = folderId;
  } else {
    delete memo.folderId;
  }
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function deleteMemo(memoId: string): Promise<void> {
  const memo = await getMemo(memoId);
  if (!memo) {
    return;
  }
  const source = getMemoDir(memoId);
  if (!source.exists) {
    return;
  }
  memo.deletedAt = new Date().toISOString();
  writeManifest(memo);
  const dest = getTrashMemoDir(memoId);
  moveMemoDirectory(source, dest);
}

export async function recoverMemo(memoId: string): Promise<void> {
  const source = getTrashMemoDir(memoId);
  if (!source.exists) {
    return;
  }
  const dest = getMemoDir(memoId);
  moveMemoDirectory(source, dest);
  const memo = await getMemo(memoId);
  if (!memo) {
    return;
  }
  delete memo.deletedAt;
  writeManifest(memo);
}

export async function permanentlyDeleteMemo(memoId: string): Promise<void> {
  const dir = getTrashMemoDir(memoId);
  if (dir.exists) {
    dir.delete();
  }
}

export async function purgeExpiredTrash(): Promise<void> {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const memos = await listTrashMemos();
  await Promise.all(
    memos
      .filter((memo) => {
        if (!memo.deletedAt) {
          return false;
        }
        return new Date(memo.deletedAt).getTime() < cutoff;
      })
      .map((memo) => permanentlyDeleteMemo(memo.id))
  );
}

export async function deleteLayer(memoId: string, layerId: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  if (getPlayableLayers(memo).length <= 1) {
    throw new Error('Cannot delete the last track');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const file = requireLayerFile(memoId, layer.fileName);
  if (file.exists) {
    file.delete();
  }

  memo.layers = memo.layers.filter((entry) => entry.id !== layerId);
  updateMemoTimeline(memo);
  normalizeLoopRegion(memo, memo.duration);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function duplicateMemo(memoId: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const copy = await createMemo({
    title: `${memo.title} copy`,
    folderId: memo.folderId,
    titleSource: 'user',
  });
  const sourceDir = resolveMemoDir(memoId);
  if (!sourceDir) {
    throw new Error('Memo not found');
  }
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
    deletedAt: undefined,
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

export async function exportMemoToFile(memo: Memo, format: ExportFormat): Promise<File> {
  if (!hasRecording(memo)) {
    throw new Error('This memo has no recorded audio.');
  }

  const rendered = await renderMemoForShare(memo);
  const baseName = sanitizeExportFileName(memo.title);
  const extension = format === 'm4a' ? 'm4a' : 'wav';
  const output = new File(Paths.cache, `${baseName}.${extension}`);

  if (output.exists) {
    output.delete();
  }

  if (format === 'wav') {
    writeAudioBufferToWavFile(rendered, output.uri);
    return output;
  }

  const wavTemp = new File(Paths.cache, `export-${memo.id}.tmp.wav`);
  if (wavTemp.exists) {
    wavTemp.delete();
  }

  writeAudioBufferToWavFile(rendered, wavTemp.uri);
  await encodeWavToM4a(wavTemp.uri, output.uri);
  if (wavTemp.exists) {
    wavTemp.delete();
  }

  if (!output.exists) {
    throw new Error('Failed to create M4A export file.');
  }

  return output;
}
