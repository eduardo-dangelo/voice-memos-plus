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

export function getMemoDir(memoId: string): Directory {
  return new Directory(getMemosRoot(), memoId);
}

export function getManifestFile(memoId: string): File {
  return new File(getMemoDir(memoId), 'manifest.json');
}

export function getLayerFile(memoId: string, fileName: string): File {
  return new File(getMemoDir(memoId), fileName);
}

export function getPrimaryLayerFile(memo: Memo): File {
  const layer = memo.layers[0];
  return getLayerFile(memo.id, layer?.fileName ?? 'layer-0.m4a');
}

export function getLayerFileById(memo: Memo, layerId: string): File | null {
  const layer = memo.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    return null;
  }
  return getLayerFile(memo.id, layer.fileName);
}

export function layerFileExists(memo: Memo): boolean {
  return getPrimaryLayerFile(memo).exists;
}

export function getMemoLayersForPlayback(memo: Memo): LoadedLayer[] {
  return getPlayableLayers(memo).map((layer) => ({
    id: layer.id,
    path: getLayerFile(memo.id, layer.fileName).uri,
    startTime: layer.startTime,
    duration: layer.duration,
    effects: getLayerEffects(layer),
  }));
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
