import { Directory, File, Paths } from 'expo-file-system';

import {
  computeWaveformPeaksFromChannelData,
  layerWaveformPeaksAreCurrent,
  peakCountForDuration,
  resolveWaveformPeaks,
  waveformPeaksFromCaptured,
} from '@/src/audio/waveform';
import { readWavDurationSec } from '@/src/audio/wavLeadingRead';
import {
  createDefaultLayerEffects,
  mergeLayerEffects,
  type LayerEffectsChange,
} from '@/src/audio/layerEffects';
import { renderLayersMix, renderMemoForShare } from '@/src/audio/memoExport';
import {
  buildMergedLayerLabel,
  resolveMergeSurvivor,
} from '@/src/audio/mergeLayersLogic';
import {
  applyRecordingIoLatencyTrim,
  getRecordingReplacementSkipSeconds,
  type RecordingLatencySkipOptions,
} from '@/src/audio/recordingLatency';
import {
  applyStackAlignmentTrimDelta,
  estimateStackAlignmentFromFiles,
  findStackAlignmentReference,
} from '@/src/audio/stackAlignment';
import { spliceRecording, writeAudioBufferToWavFile } from '@/src/audio/wavUtils';
import { encodeWavToM4a } from 'audio-encode';
import {
  DEFAULT_TRACK_COLOR,
  isTrackColorAllowed,
  pickRandomTrackColor,
} from '@/constants/VoiceMemosColors';
import { notifyMemoUpdate } from '@/src/recording/memoUpdateEvents';
import { createDefaultTitle, sanitizeExportFileName } from '@/src/utils/format';
import { randomId } from '@/src/utils/id';

import { nextLayerOrder } from './layerOrder';

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
import type { Layer, Memo, MetronomeSettings, PrecountMode } from './types';
import {
  DEFAULT_PRECOUNT_MODE,
  getDefaultLayerLabel,
  getLayerActiveStartTime,
  getLayerEffects,
  getMemoMetronomeSettings,
  getMemoTimelineDuration,
  getPlayableLayers,
  normalizeLayerLoopUntil,
  normalizeLayers,
  normalizeLoopRegion,
  normalizeMetronomeSettings,
  normalizePrecountMode,
  hasRecording,
} from './types';

export type ExportFormat = 'm4a' | 'wav' | 'vmp';

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
  capturedPeaks?: number[],
  precomputed?: { duration: number; waveformPeaks: number[] }
): Promise<void> {
  if (
    precomputed &&
    precomputed.duration > 0 &&
    precomputed.waveformPeaks.length > 0
  ) {
    layer.duration = precomputed.duration;
    layer.waveformPeaks = precomputed.waveformPeaks;
    layer.effects = createDefaultLayerEffects(layer.duration);
    return;
  }

  const file = requireLayerFile(memo.id, layer.fileName);
  const { decodeAudioData } = await import('react-native-audio-api');
  const buffer = await decodeAudioData(file.uri);
  layer.duration = buffer.duration;
  // Pass channel data so file-peak fallback does not decode a second time.
  layer.waveformPeaks = await resolveWaveformPeaks(
    file.uri,
    buffer.duration,
    capturedPeaks,
    buffer.getChannelData(0)
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
  precount?: PrecountMode;
  metronome?: Partial<MetronomeSettings>;
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
    precount:
      normalized.precount !== undefined
        ? normalizePrecountMode(normalized.precount)
        : DEFAULT_PRECOUNT_MODE,
    layers: [createLayer(0)],
  };
  if (normalized.folderId) {
    memo.folderId = normalized.folderId;
  }
  if (normalized.titleSource) {
    memo.titleSource = normalized.titleSource;
  }
  if (normalized.metronome) {
    memo.metronome = normalizeMetronomeSettings(normalized.metronome);
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
  notifyMemoUpdate(memo);
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
  loopEnabled: boolean,
  loopSnapToGrid?: boolean
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.loopStart = loopStart;
  memo.loopEnd = loopEnd;
  memo.loopEnabled = loopEnabled;
  if (loopSnapToGrid !== undefined) {
    memo.loopSnapToGrid = loopSnapToGrid;
  }
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

export async function markAccordionAutoEnablePromptSeen(memoId: string): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.accordionAutoEnablePromptSeen = true;
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export async function updateTrackAccordionEnabled(
  memoId: string,
  enabled: boolean
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  if (enabled) {
    memo.trackAccordionEnabled = true;
  } else {
    delete memo.trackAccordionEnabled;
  }
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
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

export async function updatePrecountMode(
  memoId: string,
  mode: PrecountMode
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }
  memo.precount = normalizePrecountMode(mode);
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
      const delta = nextStartTime - entry.startTime;
      entry.startTime = nextStartTime;
      if (entry.loopUntil != null && Number.isFinite(entry.loopUntil) && delta !== 0) {
        entry.loopUntil = entry.loopUntil + delta;
      }
    }
  }

  normalizeLayers(memo);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

/** Persist per-track loop footprint end. Pass null/undefined to clear looping. */
export async function updateLayerLoopUntil(
  memoId: string,
  layerId: string,
  loopUntil: number | null | undefined
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  if (loopUntil == null || !Number.isFinite(loopUntil)) {
    delete layer.loopUntil;
  } else {
    layer.loopUntil = loopUntil;
  }
  normalizeLayerLoopUntil(layer);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export type EnsureWaveformPeaksOptions = {
  onlyLayerIds?: string[];
};

export async function ensureWaveformPeaks(
  memo: Memo,
  options?: EnsureWaveformPeaksOptions
): Promise<Memo> {
  let changed = false;
  const onlyLayerIds = options?.onlyLayerIds
    ? new Set(options.onlyLayerIds)
    : null;

  for (const layer of memo.layers) {
    if (layer.duration <= 0) {
      continue;
    }
    if (onlyLayerIds && !onlyLayerIds.has(layer.id)) {
      continue;
    }

    const file = requireLayerFile(memo.id, layer.fileName);
    if (!file.exists) {
      continue;
    }

    try {
      const fileDurationSec = await readWavDurationSec(file.uri);
      if (layerWaveformPeaksAreCurrent(layer, fileDurationSec)) {
        continue;
      }

      const { decodeAudioData } = await import('react-native-audio-api');
      const buffer = await decodeAudioData(file.uri);
      if (
        buffer.duration > 0 &&
        Math.abs(buffer.duration - layer.duration) > 0.05
      ) {
        layer.duration = buffer.duration;
        changed = true;
      }
      const nextPeaks = computeWaveformPeaksFromChannelData(
        buffer.getChannelData(0),
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
  duration: number,
  capturedPeaks?: number[],
  options?: RecordingLatencySkipOptions
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

  const precomputedPeaks =
    duration > 0 ? waveformPeaksFromCaptured(capturedPeaks, duration) : undefined;
  await refreshLayerFromFile(
    memo,
    layer,
    capturedPeaks,
    precomputedPeaks && duration > 0
      ? { duration, waveformPeaks: precomputedPeaks }
      : undefined
  );
  applyRecordingIoLatencyTrim(layer, options);
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
  capturedPeaks?: number[],
  precomputed?: { duration: number; waveformPeaks: number[] }
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }

  const previousEffects = getLayerEffects(layer);
  const previousDuration = layer.duration;

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

  await refreshLayerFromFile(memo, layer, capturedPeaks, precomputed);

  // refreshLayerFromFile resets effects; restore so latency trim / mix settings survive.
  const trimOutWasFull = previousEffects.trimOut >= previousDuration - 0.001;
  layer.effects = mergeLayerEffects(
    getLayerEffects(layer),
    {
      trimIn: previousEffects.trimIn,
      trimOut: trimOutWasFull ? layer.duration : previousEffects.trimOut,
      volumeDb: previousEffects.volumeDb,
      pan: previousEffects.pan,
      muted: previousEffects.muted,
      solo: previousEffects.solo,
      locked: previousEffects.locked,
      reverb: previousEffects.reverb,
      delay: previousEffects.delay,
      eq: previousEffects.eq,
    },
    layer.duration
  );

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
  color?: string,
  options?: RecordingLatencySkipOptions & { duration?: number }
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const order = nextLayerOrder(memo);
  const usedColors = memo.layers.map(
    (entry) => entry.color ?? DEFAULT_TRACK_COLOR
  );
  const extension: '.m4a' | '.wav' = sourcePath.toLowerCase().endsWith('.wav')
    ? '.wav'
    : '.m4a';
  const fileName = allocateUniqueLayerFileName(memo, order, extension);
  const layer: Layer = {
    id: randomId(),
    order,
    fileName,
    label: getDefaultLayerLabel(order),
    color:
      usedColors.length === 0
        ? DEFAULT_TRACK_COLOR
        : pickRandomTrackColor(usedColors),
    startTime,
    duration: 0,
  };
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

  const knownDuration = options?.duration ?? 0;
  const precomputedPeaks =
    knownDuration > 0
      ? waveformPeaksFromCaptured(capturedPeaks, knownDuration)
      : undefined;
  await refreshLayerFromFile(
    memo,
    layer,
    capturedPeaks,
    precomputedPeaks && knownDuration > 0
      ? { duration: knownDuration, waveformPeaks: precomputedPeaks }
      : undefined
  );
  applyRecordingIoLatencyTrim(layer, {
    softwareCue: options?.softwareCue === true,
    cueRoute: options?.cueRoute,
    measuredCueLeadSec: options?.measuredCueLeadSec,
    monitorPath: options?.monitorPath,
    inputLatencySec: options?.inputLatencySec,
    outputLatencySec: options?.outputLatencySec,
  });

  memo.layers.push(layer);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

/**
 * Sample-accurate PCM fine-trim vs an existing layer at the same stack point.
 * Unused on the save path (Logic I/O placement); kept for tests / manual recovery.
 */
export async function alignStackedLayer(
  memoId: string,
  layerId: string
): Promise<Memo | null> {
  const memo = await getMemo(memoId);
  if (!memo) {
    return null;
  }

  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer || layer.duration <= 0) {
    return null;
  }

  const stackPoint = getLayerActiveStartTime(layer);
  const reference = findStackAlignmentReference(memo, stackPoint, layer.id);
  if (!reference) {
    return null;
  }

  const referenceFile = requireLayerFile(memoId, reference.fileName);
  const candidateFile = requireLayerFile(memoId, layer.fileName);
  const estimate = await estimateStackAlignmentFromFiles(
    referenceFile.uri,
    candidateFile.uri,
    reference.id,
    {
      referenceTrimInSec: getLayerEffects(reference).trimIn,
      candidateTrimInSec: getLayerEffects(layer).trimIn,
    }
  );
  if (!estimate) {
    return null;
  }

  applyStackAlignmentTrimDelta(layer, estimate.deltaTrimSec);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

export type ReplaceLayerSegmentResult = {
  memo: Memo;
  /** PCM for warm playback cache — use final layer path after replace. */
  prime?: {
    path: string;
    samples: Float32Array;
    sampleRate: number;
  };
};

export async function replaceLayerSegment(
  memoId: string,
  layerId: string,
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  leadingPadSeconds = 0,
  options?: RecordingLatencySkipOptions & {
    /** Precomputed skip — must match hole sizing in getReplaceSpliceParams. */
    replacementSkipSeconds?: number;
  }
): Promise<ReplaceLayerSegmentResult> {
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

  const replacementSkipSeconds =
    options?.replacementSkipSeconds ??
    getRecordingReplacementSkipSeconds(
      options?.softwareCue === true,
      options?.cueRoute ?? 'wired',
      {
        measuredCueLeadSec: options?.measuredCueLeadSec,
        monitorPath: options?.monitorPath,
        inputLatencySec: options?.inputLatencySec,
        outputLatencySec: options?.outputLatencySec,
      }
    );

  const splice = await spliceRecording(
    original.uri,
    trimStart,
    trimEnd,
    replacementPath,
    output.uri,
    {
      leadingPadSeconds,
      replacementSkipSeconds,
    }
  );

  // Peaks from splice PCM — full-file density, no extra decode/scan.
  const waveformPeaks = computeWaveformPeaksFromChannelData(
    splice.samples,
    peakCountForDuration(splice.duration)
  );

  const updated = await replaceLayerFile(memoId, layerId, output.uri, undefined, {
    duration: splice.duration,
    waveformPeaks,
  });

  const updatedLayer = updated.layers.find((entry) => entry.id === layerId);
  const destPath = updatedLayer
    ? requireLayerFile(memoId, updatedLayer.fileName).uri
    : undefined;

  return {
    memo: updated,
    prime: destPath
      ? {
          path: destPath,
          samples: splice.samples,
          sampleRate: splice.sampleRate,
        }
      : undefined,
  };
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

function allocateUniqueLayerFileName(
  memo: Memo,
  preferredOrder: number,
  extension: '.m4a' | '.wav'
): string {
  const used = new Set(memo.layers.map((entry) => entry.fileName));
  let index = preferredOrder;
  let fileName = `layer-${index}${extension}`;
  while (used.has(fileName)) {
    index += 1;
    fileName = `layer-${index}${extension}`;
  }
  return fileName;
}

/** Clones a layer’s audio file and metadata into a new track in the same memo. */
export async function duplicateLayer(
  memoId: string,
  layerId: string
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const source = memo.layers.find((entry) => entry.id === layerId);
  if (!source || source.duration <= 0) {
    throw new Error('Layer not found');
  }

  const sourceFile = requireLayerFile(memoId, source.fileName);
  if (!sourceFile.exists) {
    throw new Error('Layer file not found');
  }

  const order = nextLayerOrder(memo);
  const extension = source.fileName.toLowerCase().endsWith('.wav')
    ? '.wav'
    : '.m4a';
  const fileName = allocateUniqueLayerFileName(memo, order, extension);
  const dest = requireLayerFile(memoId, fileName);
  if (dest.exists) {
    dest.delete();
  }
  sourceFile.copy(dest);

  const layer: Layer = {
    id: randomId(),
    order,
    fileName,
    label: `${source.label} copy`,
    color: pickRandomTrackColor(
      memo.layers.map((entry) => entry.color ?? DEFAULT_TRACK_COLOR)
    ),
    startTime: source.startTime,
    duration: source.duration,
    ...(source.loopUntil !== undefined ? { loopUntil: source.loopUntil } : {}),
    ...(source.waveformPeaks
      ? { waveformPeaks: [...source.waveformPeaks] }
      : {}),
    ...(source.effects
      ? { effects: JSON.parse(JSON.stringify(source.effects)) as Layer['effects'] }
      : {}),
  };

  memo.layers.push(layer);
  updateMemoTimeline(memo);
  memo.updatedAt = new Date().toISOString();
  writeManifest(memo);
  return memo;
}

/**
 * Offline-mixes the given layers into one survivor track and deletes the rest.
 * Prefer `survivorId` (e.g. long-press anchor); otherwise lowest-order selected.
 */
export async function mergeLayers(
  memoId: string,
  layerIds: string[],
  survivorId?: string
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const uniqueIds = [...new Set(layerIds)];
  const survivor = resolveMergeSurvivor(memo.layers, uniqueIds, survivorId);
  const mergedLabel = buildMergedLayerLabel(memo.layers, uniqueIds, survivor.id);
  const removeIds = new Set(uniqueIds.filter((id) => id !== survivor.id));

  const rendered = await renderLayersMix(memo, uniqueIds, { bounds: 'timeline' });
  const temp = new File(Paths.cache, `merge-${memo.id}-${Date.now()}.wav`);
  if (temp.exists) {
    temp.delete();
  }
  writeAudioBufferToWavFile(rendered, temp.uri);

  try {
    const liveSurvivor = memo.layers.find((entry) => entry.id === survivor.id);
    if (!liveSurvivor) {
      throw new Error('Track not found.');
    }

    liveSurvivor.label = mergedLabel;

    const previousFileName = liveSurvivor.fileName;
    alignLayerFileNameWithSource(liveSurvivor, temp.uri);

    if (previousFileName !== liveSurvivor.fileName) {
      const oldFile = requireLayerFile(memoId, previousFileName);
      if (oldFile.exists) {
        oldFile.delete();
      }
    }

    const dest = requireLayerFile(memoId, liveSurvivor.fileName);
    if (dest.exists) {
      dest.delete();
    }
    await temp.copy(dest);

    const peakCount = peakCountForDuration(rendered.duration);
    const waveformPeaks = computeWaveformPeaksFromChannelData(
      rendered.getChannelData(0),
      peakCount
    );
    await refreshLayerFromFile(memo, liveSurvivor, undefined, {
      duration: rendered.duration,
      waveformPeaks,
    });
    liveSurvivor.startTime = 0;
    liveSurvivor.effects = createDefaultLayerEffects(liveSurvivor.duration);

    for (const layer of memo.layers) {
      if (!removeIds.has(layer.id)) {
        continue;
      }
      const file = requireLayerFile(memoId, layer.fileName);
      if (file.exists) {
        file.delete();
      }
    }
    memo.layers = memo.layers.filter((entry) => !removeIds.has(entry.id));

    updateMemoTimeline(memo);
    normalizeLoopRegion(memo, memo.duration);
    memo.updatedAt = new Date().toISOString();
    writeManifest(memo);
    return memo;
  } finally {
    if (temp.exists) {
      temp.delete();
    }
  }
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

export async function exportMemoToFile(
  memo: Memo,
  format: ExportFormat,
  layerId?: string
): Promise<File> {
  if (!hasRecording(memo)) {
    throw new Error('This memo has no recorded audio.');
  }

  if (format === 'vmp') {
    if (layerId) {
      throw new Error('Project export is only available for the full memo.');
    }
    const { packMemoToProjectFile } = await import('./memoPackage');
    return packMemoToProjectFile(memo);
  }

  const rendered = await renderMemoForShare(memo, layerId);
  const layer = layerId ? memo.layers.find((entry) => entry.id === layerId) : undefined;
  const baseName = sanitizeExportFileName(
    layer ? `${memo.title} - ${layer.label}` : memo.title
  );
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
