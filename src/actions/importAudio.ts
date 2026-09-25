import { Alert } from 'react-native';

import {
  convertPickedAudioToMonoWav,
  deleteImportedTempFile,
  pickAudioFile,
  pickImportableFile,
  type ConvertedImportAudio,
} from '@/src/audio/importAudioFile';
import { importProjectFromCachedUri } from '@/src/actions/importMemo';
import { showImportSuccess } from '@/src/components/ImportSuccessDialog';
import { isProjectFileName } from '@/src/storage/memoPackage';
import { addImportedAudioLayer, createMemo } from '@/src/storage/memoStore';
import { getMemoDir } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';

export type ImportFileKind = 'project' | 'audio';

export type ImportAudioOptions = {
  folderId?: string;
  onImportStarted?: (kind?: ImportFileKind) => void;
  onImportFinished?: () => void;
};

export type ImportAudioResult =
  | { status: 'canceled' }
  | { status: 'imported'; memo: Memo };

export type ImportAudioLayerResult =
  | { status: 'canceled' }
  | { status: 'imported'; memo: Memo };

async function waitForOverlayFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function convertAfterPick(
  picked: { uri: string; name: string; size?: number },
  options?: ImportAudioOptions
): Promise<ConvertedImportAudio> {
  options?.onImportStarted?.();
  await waitForOverlayFrame();
  try {
    return await convertPickedAudioToMonoWav(picked);
  } catch (error) {
    deleteImportedTempFile(picked.uri);
    throw error;
  }
}

async function addConvertedLayer(
  memoId: string,
  converted: ConvertedImportAudio,
  sourceUri: string
): Promise<Memo> {
  try {
    return await addImportedAudioLayer(memoId, converted.wavPath, {
      duration: converted.duration,
      waveformPeaks: converted.waveformPeaks,
      label: converted.displayName,
    });
  } finally {
    deleteImportedTempFile(converted.wavPath);
    deleteImportedTempFile(sourceUri);
  }
}

/** Opens the audio picker and adds the file as the first layer of a new memo. */
export async function importAudioAsNewMemo(
  options?: ImportAudioOptions
): Promise<ImportAudioResult> {
  try {
    const picked = await pickAudioFile();
    if (picked.canceled) {
      return { status: 'canceled' };
    }

    const converted = await convertAfterPick(picked, options);
    return {
      status: 'imported',
      memo: await createMemoFromConverted(converted, picked.uri, options),
    };
  } finally {
    options?.onImportFinished?.();
  }
}

async function createMemoFromConverted(
  converted: ConvertedImportAudio,
  sourceUri: string,
  options?: ImportAudioOptions
): Promise<Memo> {
  try {
    const shell = await createMemo({
      title: converted.displayName,
      folderId: options?.folderId,
      titleSource: 'user',
    });
    try {
      return await addConvertedLayer(shell.id, converted, sourceUri);
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
  } catch (error) {
    deleteImportedTempFile(converted.wavPath);
    deleteImportedTempFile(sourceUri);
    throw error;
  }
}

/** Opens a picker for audio or `.vmp` and creates a new memo. */
export async function importFileAsNewMemo(
  options?: ImportAudioOptions
): Promise<ImportAudioResult> {
  try {
    const picked = await pickImportableFile();
    if (picked.canceled) {
      return { status: 'canceled' };
    }

    if (isProjectFileName(picked.name)) {
      options?.onImportStarted?.('project');
      await waitForOverlayFrame();
      try {
        const memo = await importProjectFromCachedUri(picked.uri, {
          folderId: options?.folderId,
        });
        return { status: 'imported', memo };
      } finally {
        deleteImportedTempFile(picked.uri);
      }
    }

    const converted = await convertAfterPick(picked, {
      ...options,
      onImportStarted: () => options?.onImportStarted?.('audio'),
    });
    return {
      status: 'imported',
      memo: await createMemoFromConverted(converted, picked.uri, options),
    };
  } finally {
    options?.onImportFinished?.();
  }
}

/** Opens the audio picker and appends the file as a layer on an existing memo. */
export async function importAudioAsLayer(
  memoId: string,
  options?: ImportAudioOptions
): Promise<ImportAudioLayerResult> {
  const picked = await pickAudioFile();
  if (picked.canceled) {
    options?.onImportFinished?.();
    return { status: 'canceled' };
  }

  try {
    const converted = await convertAfterPick(picked, options);
    const memo = await addConvertedLayer(memoId, converted, picked.uri);
    return { status: 'imported', memo };
  } finally {
    options?.onImportFinished?.();
  }
}

/** Convenience wrapper with Alert error handling for list call sites. */
export function promptImportAudio(
  options?: ImportAudioOptions & {
    onImported?: (memo: Memo) => void;
  }
): void {
  void importAudioAsNewMemo(options)
    .then((result) => {
      if (result.status === 'canceled') {
        return;
      }
      options?.onImported?.(result.memo);
      showImportSuccess({ title: result.memo.title });
    })
    .catch((error) => {
      Alert.alert(
        'Import failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    });
}

/** List import: one picker for audio files and `.vmp` projects. */
export function promptImportFile(
  options?: ImportAudioOptions & {
    onImported?: (memo: Memo) => void;
  }
): void {
  void importFileAsNewMemo(options)
    .then((result) => {
      if (result.status === 'canceled') {
        return;
      }
      options?.onImported?.(result.memo);
      showImportSuccess({ title: result.memo.title });
    })
    .catch((error) => {
      Alert.alert(
        'Import failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    });
}
