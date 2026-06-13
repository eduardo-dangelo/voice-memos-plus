import { Directory, File, Paths } from 'expo-file-system';

import { computeWaveformPeaks, resolveWaveformPeaks } from '@/src/audio/waveform';
import { spliceRecording } from '@/src/audio/wavUtils';
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

function createLayer(order: number): Layer {
  return {
    id: randomId(),
    order,
    fileName: `layer-${order}.m4a`,
    label: `Layer ${order + 1}`,
  };
}

function readManifest(file: File): Memo | null {
  if (!file.exists) {
    return null;
  }
  try {
    const memo = JSON.parse(file.textSync()) as Memo;
    if (!memo.trimEnd && memo.duration > 0) {
      memo.trimEnd = memo.duration;
    }
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

export async function ensureWaveformPeaks(memo: Memo): Promise<Memo> {
  const layer = memo.layers[0];
  if (!layer || layer.waveformPeaks && layer.waveformPeaks.length > 0) {
    return memo;
  }

  const file = getPrimaryLayerFile(memo);
  if (!file.exists || memo.duration <= 0) {
    return memo;
  }

  try {
    layer.waveformPeaks = await computeWaveformPeaks(file.uri);
    memo.updatedAt = new Date().toISOString();
    writeManifest(memo);
  } catch {
    // Leave peaks unset; UI falls back to placeholder bars.
  }

  return memo;
}

export async function saveRecording(
  memoId: string,
  sourcePath: string,
  duration: number,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const layer = memo.layers[0] ?? createLayer(0);
  memo.layers = [layer];
  const dest = getLayerFile(memoId, layer.fileName);
  const source = new File(sourcePath);

  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  memo.duration = duration;
  memo.trimStart = 0;
  memo.trimEnd = duration;
  memo.updatedAt = new Date().toISOString();

  memo.layers[0].waveformPeaks = await resolveWaveformPeaks(dest.uri, capturedPeaks);

  writeManifest(memo);
  return memo;
}

export async function replaceLayerFile(
  memoId: string,
  sourcePath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const dest = getPrimaryLayerFile(memo);
  const source = new File(sourcePath);

  if (dest.exists) {
    dest.delete();
  }
  source.copy(dest);

  const { decodeAudioData } = await import('react-native-audio-api');
  const buffer = await decodeAudioData(dest.uri);
  memo.duration = buffer.duration;
  memo.trimStart = 0;
  memo.trimEnd = buffer.duration;
  memo.updatedAt = new Date().toISOString();

  memo.layers[0].waveformPeaks = await resolveWaveformPeaks(dest.uri, capturedPeaks);

  writeManifest(memo);
  return memo;
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
  trimStart: number,
  trimEnd: number,
  replacementPath: string,
  capturedPeaks?: number[]
): Promise<Memo> {
  const memo = await getMemo(memoId);
  if (!memo) {
    throw new Error('Memo not found');
  }

  const original = getPrimaryLayerFile(memo);
  const output = new File(Paths.cache, `splice-${memoId}.m4a`);

  if (output.exists) {
    output.delete();
  }

  await spliceRecording(original.uri, trimStart, trimEnd, replacementPath, output.uri);
  return replaceLayerFile(memoId, output.uri, capturedPeaks);
}

export function getShareableFile(memo: Memo): File {
  return getPrimaryLayerFile(memo);
}
