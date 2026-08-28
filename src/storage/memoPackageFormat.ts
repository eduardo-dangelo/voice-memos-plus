import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import { randomId } from '@/src/utils/id';

import type { Layer, Memo } from './types';
import {
  getMemoTimelineDuration,
  hasRecording,
  normalizeLayers,
  normalizeLoopRegion,
  normalizeMetronomeSettings,
  normalizePrecountMode,
} from './types';

export const PROJECT_FORMAT_ID = 'voice-memos-plus-project';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_PACKAGE_META_PATH = 'package.json';
export const PROJECT_MANIFEST_PATH = 'manifest.json';
export const PROJECT_MEDIA_PREFIX = 'media/';
/** File extension for portable project packages (without dot). */
export const PROJECT_FILE_EXTENSION = 'vmp';
/** MIME type registered for `.vmp` (used by share + document picker). */
export const PROJECT_MIME_TYPE = 'application/vnd.voice-memos-plus.project';
/** iOS UTI for `.vmp` project packages. */
export const PROJECT_UTI = 'com.eduardodangelo.voicememosplus.project';

export function isProjectFileName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`);
}

export type MemoProjectPackageMeta = {
  format: typeof PROJECT_FORMAT_ID;
  schemaVersion: number;
  exportedAt: string;
  appVersion?: string;
};

export type ValidatedProjectArchive = {
  meta: MemoProjectPackageMeta;
  manifest: Memo;
  /** basename → bytes for each media file referenced by layers with duration > 0 */
  media: Map<string, Uint8Array>;
};

function textEncoderBytes(value: string): Uint8Array {
  return strToU8(value);
}

function textDecoderString(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

function normalizeArchivePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

export function mediaBasename(fileName: string): string {
  const normalized = normalizeArchivePath(fileName);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function packagedMediaPath(fileName: string): string {
  return `${PROJECT_MEDIA_PREFIX}${mediaBasename(fileName)}`;
}

function isCompressedAudioName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.m4a') || lower.endsWith('.wav') || lower.endsWith('.aac');
}

/** Build the memo document written into a project archive (relative media paths). */
export function buildExportableManifest(memo: Memo): Memo {
  const layers: Layer[] = memo.layers.map((layer) => ({
    ...layer,
    fileName: packagedMediaPath(layer.fileName),
    effects: layer.effects ? { ...layer.effects } : undefined,
    waveformPeaks: layer.waveformPeaks ? [...layer.waveformPeaks] : undefined,
  }));

  const exported: Memo = {
    id: memo.id,
    title: memo.title,
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
    duration: getMemoTimelineDuration(memo),
    trimStart: memo.trimStart,
    trimEnd: memo.trimEnd,
    layers,
  };

  if (memo.titleSource) {
    exported.titleSource = memo.titleSource;
  }
  if (memo.loopStart !== undefined) {
    exported.loopStart = memo.loopStart;
  }
  if (memo.loopEnd !== undefined) {
    exported.loopEnd = memo.loopEnd;
  }
  if (memo.loopEnabled !== undefined) {
    exported.loopEnabled = memo.loopEnabled;
  }
  if (memo.loopSnapToGrid !== undefined) {
    exported.loopSnapToGrid = memo.loopSnapToGrid;
  }
  if (memo.metronome) {
    exported.metronome = normalizeMetronomeSettings(memo.metronome);
  }
  if (memo.precount !== undefined) {
    exported.precount = normalizePrecountMode(memo.precount);
  }
  if (memo.accordionAutoEnablePromptSeen !== undefined) {
    exported.accordionAutoEnablePromptSeen = memo.accordionAutoEnablePromptSeen;
  }

  return exported;
}

export function buildPackageMeta(options?: {
  exportedAt?: string;
  appVersion?: string;
}): MemoProjectPackageMeta {
  return {
    format: PROJECT_FORMAT_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    ...(options?.appVersion ? { appVersion: options.appVersion } : {}),
  };
}

function parsePackageMeta(raw: unknown): MemoProjectPackageMeta {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid project package metadata.');
  }
  const value = raw as Record<string, unknown>;
  if (value.format !== PROJECT_FORMAT_ID) {
    throw new Error('This file is not a Voice Memos Plus project.');
  }
  if (typeof value.schemaVersion !== 'number' || !Number.isFinite(value.schemaVersion)) {
    throw new Error('Project package is missing a schema version.');
  }
  if (value.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `This project requires a newer app (schema ${value.schemaVersion}).`
    );
  }
  if (value.schemaVersion < 1) {
    throw new Error('Unsupported project schema version.');
  }
  if (typeof value.exportedAt !== 'string' || !value.exportedAt) {
    throw new Error('Project package is missing an export timestamp.');
  }
  return {
    format: PROJECT_FORMAT_ID,
    schemaVersion: value.schemaVersion,
    exportedAt: value.exportedAt,
    ...(typeof value.appVersion === 'string' ? { appVersion: value.appVersion } : {}),
  };
}

/** Remap packaged memo identity for import into the local library. */
export function remapImportedMemo(
  packaged: Memo,
  options: {
    newMemoId: string;
    folderId?: string;
    now?: string;
  }
): Memo {
  const now = options.now ?? new Date().toISOString();
  const layers: Layer[] = packaged.layers.map((layer, index) => ({
    ...layer,
    id: randomId(),
    order: layer.order ?? index,
    fileName: mediaBasename(layer.fileName),
    effects: layer.effects ? { ...layer.effects } : undefined,
    waveformPeaks: layer.waveformPeaks ? [...layer.waveformPeaks] : undefined,
  }));

  const memo: Memo = {
    id: options.newMemoId,
    title: packaged.title?.trim() || 'Imported Recording',
    createdAt: packaged.createdAt || now,
    updatedAt: now,
    duration: packaged.duration,
    trimStart: packaged.trimStart ?? 0,
    trimEnd: packaged.trimEnd ?? 0,
    layers,
  };

  if (packaged.titleSource) {
    memo.titleSource = packaged.titleSource;
  }
  if (packaged.loopStart !== undefined) {
    memo.loopStart = packaged.loopStart;
  }
  if (packaged.loopEnd !== undefined) {
    memo.loopEnd = packaged.loopEnd;
  }
  if (packaged.loopEnabled !== undefined) {
    memo.loopEnabled = packaged.loopEnabled;
  }
  if (packaged.loopSnapToGrid !== undefined) {
    memo.loopSnapToGrid = packaged.loopSnapToGrid;
  }
  if (packaged.metronome) {
    memo.metronome = normalizeMetronomeSettings(packaged.metronome);
  }
  if (packaged.precount !== undefined) {
    memo.precount = normalizePrecountMode(packaged.precount);
  }
  if (packaged.accordionAutoEnablePromptSeen !== undefined) {
    memo.accordionAutoEnablePromptSeen = packaged.accordionAutoEnablePromptSeen;
  }
  if (options.folderId) {
    memo.folderId = options.folderId;
  }

  normalizeLayers(memo);
  const timeline = getMemoTimelineDuration(memo);
  memo.duration = timeline;
  if (memo.trimEnd === 0 && timeline > 0) {
    memo.trimEnd = timeline;
  }
  normalizeLoopRegion(memo, timeline);
  return memo;
}

/**
 * Validate an unzipped project archive.
 * `files` keys are archive-relative paths.
 */
export function validateProjectArchive(
  files: Record<string, Uint8Array>
): ValidatedProjectArchive {
  const normalized: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (!bytes) {
      continue;
    }
    const key = normalizeArchivePath(path);
    if (!key || key.endsWith('/')) {
      continue;
    }
    normalized[key] = bytes;
  }

  const metaBytes = normalized[PROJECT_PACKAGE_META_PATH];
  if (!metaBytes) {
    throw new Error('Project package is missing package.json.');
  }
  let metaRaw: unknown;
  try {
    metaRaw = JSON.parse(textDecoderString(metaBytes));
  } catch {
    throw new Error('Project package metadata is not valid JSON.');
  }
  const meta = parsePackageMeta(metaRaw);

  const manifestBytes = normalized[PROJECT_MANIFEST_PATH];
  if (!manifestBytes) {
    throw new Error('Project package is missing manifest.json.');
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(textDecoderString(manifestBytes));
  } catch {
    throw new Error('Project manifest is not valid JSON.');
  }
  if (!manifestRaw || typeof manifestRaw !== 'object') {
    throw new Error('Project manifest is invalid.');
  }

  const manifest = normalizeLayers(manifestRaw as Memo);
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    throw new Error('Project manifest has no layers.');
  }

  const media = new Map<string, Uint8Array>();
  for (const layer of manifest.layers) {
    if (layer.duration <= 0) {
      continue;
    }
    const path = normalizeArchivePath(layer.fileName);
    const expectedPath = path.startsWith(PROJECT_MEDIA_PREFIX)
      ? path
      : packagedMediaPath(path);
    const bytes = normalized[expectedPath] ?? normalized[path];
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`Project package is missing media for “${mediaBasename(path)}”.`);
    }
    const basename = mediaBasename(expectedPath);
    media.set(basename, bytes);
    layer.fileName = `${PROJECT_MEDIA_PREFIX}${basename}`;
  }

  if (!hasRecording(manifest)) {
    throw new Error('Project package has no recorded audio.');
  }

  return { meta, manifest, media };
}

/** Zip project entries. JSON is compressed; audio is stored. */
export function zipProjectFiles(files: Record<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (isCompressedAudioName(path)) {
      zippable[path] = [bytes, { level: 0 }];
    } else {
      zippable[path] = bytes;
    }
  }
  return zipSync(zippable, { level: 6 });
}

export function unzipProjectFiles(bytes: Uint8Array): Record<string, Uint8Array> {
  const unzipped = unzipSync(bytes);
  const result: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(unzipped)) {
    if (data) {
      result[normalizeArchivePath(path)] = data;
    }
  }
  return result;
}

export function encodeProjectJson(value: unknown): Uint8Array {
  return textEncoderBytes(JSON.stringify(value, null, 2));
}
