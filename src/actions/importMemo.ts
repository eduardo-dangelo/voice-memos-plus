import { copyIncomingProjectAsync, pickProjectAsync } from 'project-document-picker';
import { Alert } from 'react-native';

import {
  isProjectFileName,
  readProjectArchiveFromUri,
  remapImportedMemo,
  writeImportedMemoFiles,
} from '@/src/storage/memoPackage';
import { createMemo, ensureWaveformPeaks } from '@/src/storage/memoStore';
import { getMemoDir } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';

export type ImportMemoOptions = {
  folderId?: string;
  onImportStarted?: () => void;
  onImportFinished?: () => void;
};

export type ImportMemoResult =
  | { status: 'canceled' }
  | { status: 'imported'; memo: Memo };

async function importFromUri(
  uri: string,
  options?: ImportMemoOptions
): Promise<Memo> {
  const validated = await readProjectArchiveFromUri(uri);
  const shell = await createMemo({
    title: validated.manifest.title?.trim() || 'Imported Recording',
    folderId: options?.folderId,
    titleSource: validated.manifest.titleSource ?? 'user',
    precount: validated.manifest.precount,
    metronome: validated.manifest.metronome,
  });

  try {
    const remapped = remapImportedMemo(validated.manifest, {
      newMemoId: shell.id,
      folderId: options?.folderId,
    });
    writeImportedMemoFiles(remapped, validated.media);

    const needsPeaks = remapped.layers.some(
      (layer) =>
        layer.duration > 0 && (!layer.waveformPeaks || layer.waveformPeaks.length === 0)
    );
    if (needsPeaks) {
      return ensureWaveformPeaks(remapped);
    }
    return remapped;
  } catch (error) {
    try {
      const dir = getMemoDir(shell.id);
      if (dir.exists) {
        dir.delete();
      }
    } catch {
      // Best-effort cleanup of the shell memo.
    }
    throw error;
  }
}

/** Import a Voice Memos Plus project from a file URI (Files / Mail / AirDrop). */
export async function importMemoFromUri(
  uri: string,
  options?: ImportMemoOptions
): Promise<Memo> {
  const cachedUri = await copyIncomingProjectAsync(uri);
  options?.onImportStarted?.();
  try {
    return await importFromUri(cachedUri, options);
  } finally {
    options?.onImportFinished?.();
  }
}

/**
 * Opens the document picker and imports a Voice Memos Plus project (`.vmp`).
 * Returns `canceled` when the user dismisses the picker.
 */
export async function importMemoFromPicker(
  options?: ImportMemoOptions
): Promise<ImportMemoResult> {
  const result = await pickProjectAsync();

  if (result.canceled) {
    return { status: 'canceled' };
  }

  if (!isProjectFileName(result.name)) {
    throw new Error('Please select a Voice Memos Plus project (.vmp) file.');
  }

  options?.onImportStarted?.();
  try {
    const memo = await importFromUri(result.uri, options);
    return { status: 'imported', memo };
  } finally {
    options?.onImportFinished?.();
  }
}

/** Convenience wrapper with Alert error handling for UI call sites. */
export function promptImportMemo(
  options?: ImportMemoOptions & {
    onImported?: (memo: Memo) => void;
  }
): void {
  void importMemoFromPicker(options)
    .then((result) => {
      if (result.status === 'canceled') {
        return;
      }
      Alert.alert('Imported', `“${result.memo.title}” was added to your library.`);
      options?.onImported?.(result.memo);
    })
    .catch((error) => {
      Alert.alert(
        'Import failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    });
}
