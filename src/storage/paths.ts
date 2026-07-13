import { Directory, File, Paths } from 'expo-file-system';

import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';
import { getLayerEffects } from '@/src/storage/types';

import type { Memo } from './types';
import { getMemoTimelineDuration, getPlayableLayers } from './types';

export function getMemosRoot(): Directory {
  const root = new Directory(Paths.document, 'memos');
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

export function getTrashMemosRoot(): Directory {
  const root = new Directory(Paths.document, 'trash', 'memos');
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

export function getFoldersFile(): File {
  const file = new File(Paths.document, 'folders.json');
  if (!file.exists) {
    file.create();
    file.write('[]');
  }
  return file;
}

export function getAppSettingsFile(): File {
  const file = new File(Paths.document, 'app-settings.json');
  if (!file.exists) {
    file.create();
    file.write('{}');
  }
  return file;
}

export function getMemoDir(memoId: string): Directory {
  return new Directory(getMemosRoot(), memoId);
}

export function getTrashMemoDir(memoId: string): Directory {
  return new Directory(getTrashMemosRoot(), memoId);
}

export function isMemoInTrash(memoId: string): boolean {
  return getTrashMemoDir(memoId).exists;
}

export function resolveMemoDir(memoId: string): Directory | null {
  const active = getMemoDir(memoId);
  if (active.exists) {
    return active;
  }
  const trash = getTrashMemoDir(memoId);
  if (trash.exists) {
    return trash;
  }
  return null;
}

export function getManifestFile(memoId: string): File | null {
  const dir = resolveMemoDir(memoId);
  if (!dir) {
    return null;
  }
  return new File(dir, 'manifest.json');
}

export function getLayerFile(memoId: string, fileName: string): File | null {
  const dir = resolveMemoDir(memoId);
  if (!dir) {
    return null;
  }
  return new File(dir, fileName);
}

export function requireLayerFile(memoId: string, fileName: string): File {
  const file = getLayerFile(memoId, fileName);
  if (!file) {
    throw new Error('Memo not found');
  }
  return file;
}

export function getPrimaryLayerFile(memo: Memo): File {
  const layer = memo.layers[0];
  const file = getLayerFile(memo.id, layer?.fileName ?? 'layer-0.m4a');
  if (!file) {
    throw new Error('Memo not found');
  }
  return file;
}

export function getLayerFileById(memo: Memo, layerId: string): File | null {
  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    return null;
  }
  return getLayerFile(memo.id, layer.fileName);
}

export function layerFileExists(memo: Memo): boolean {
  const file = getLayerFile(memo.id, memo.layers[0]?.fileName ?? 'layer-0.m4a');
  return file?.exists ?? false;
}

export function getMemoLayersForPlayback(memo: Memo): LoadedLayer[] {
  return getPlayableLayers(memo).map((layer) => {
    const file = getLayerFile(memo.id, layer.fileName);
    if (!file) {
      throw new Error('Memo not found');
    }
    return {
      id: layer.id,
      path: file.uri,
      startTime: layer.startTime,
      duration: layer.duration,
      effects: getLayerEffects(layer),
    };
  });
}

export function getMemoPlaybackTimeline(memo: Memo): {
  layers: LoadedLayer[];
  duration: number;
  trimStart: number;
  trimEnd: number;
} {
  const duration = getMemoTimelineDuration(memo);
  return {
    layers: getMemoLayersForPlayback(memo),
    duration,
    trimStart: memo.trimStart,
    trimEnd: memo.trimEnd > 0 ? memo.trimEnd : duration,
  };
}

export function moveMemoDirectory(source: Directory, dest: Directory): void {
  if (!source.exists) {
    return;
  }
  if (dest.exists) {
    dest.delete();
  }
  dest.create({ intermediates: true, idempotent: true });
  for (const entry of source.list()) {
    if (entry instanceof File) {
      entry.copy(new File(dest, entry.name));
    }
  }
  source.delete();
}
