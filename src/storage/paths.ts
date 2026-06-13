import { Directory, File, Paths } from 'expo-file-system';

import type { Memo } from './types';

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

export function layerFileExists(memo: Memo): boolean {
  return getPrimaryLayerFile(memo).exists;
}
