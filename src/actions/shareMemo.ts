import * as Sharing from 'expo-sharing';
import { ActionSheetIOS, Alert } from 'react-native';
import { shareFilesAsync } from 'share-files';

import {
  exportMemoToFile,
  type ExportFormat,
} from '@/src/storage/memoStore';
import { hasRecording, type Memo } from '@/src/storage/types';

export type ShareMemoOptions = {
  layerId?: string;
  /** When set, skip the format ActionSheet and export directly. */
  format?: ExportFormat;
  onExportStarted?: () => void;
  onExportFinished?: () => void;
};

const AUDIO_FORMATS = ['m4a', 'wav'] as const;
const PROJECT_FORMAT_LABEL = 'Project (.vmp)';

function getShareMimeType(format: ExportFormat): string {
  if (format === 'vmp') {
    // Share as zip so Files/AirDrop type the package as an archive the picker can match.
    return 'application/zip';
  }
  return format === 'm4a' ? 'audio/mp4' : 'audio/wav';
}

function getShareUti(format: ExportFormat): string {
  if (format === 'vmp') {
    return 'public.zip-archive';
  }
  return format === 'm4a' ? 'public.mpeg-4-audio' : 'com.microsoft.waveform-audio';
}

function resolveFormatSelection(label: string): ExportFormat | null {
  if (label === 'm4a' || label === 'wav') {
    return label;
  }
  if (label === PROJECT_FORMAT_LABEL) {
    return 'vmp';
  }
  return null;
}

function showFormatPicker(
  includeProject: boolean,
  onFormat: (format: ExportFormat) => void
): void {
  const sheetOptions = includeProject
    ? ([...AUDIO_FORMATS, PROJECT_FORMAT_LABEL, 'Cancel'] as const)
    : ([...AUDIO_FORMATS, 'Cancel'] as const);
  const cancelIndex = sheetOptions.indexOf('Cancel');

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Choose format…',
      options: [...sheetOptions],
      cancelButtonIndex: cancelIndex,
    },
    (index) => {
      const selected = sheetOptions[index];
      if (!selected || selected === 'Cancel') {
        return;
      }
      const format = resolveFormatSelection(selected);
      if (!format) {
        return;
      }
      onFormat(format);
    }
  );
}

async function exportAndShare(
  memo: Memo,
  format: ExportFormat,
  options?: ShareMemoOptions
): Promise<void> {
  options?.onExportStarted?.();

  try {
    const file = await exportMemoToFile(memo, format, options?.layerId);
    if (!file.exists) {
      throw new Error('Export file was not created.');
    }

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is not available on this device.');
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: getShareMimeType(format),
      UTI: getShareUti(format),
    });
  } finally {
    options?.onExportFinished?.();
  }
}

async function exportAndShareMany(
  memos: Memo[],
  format: ExportFormat,
  options?: ShareMemoOptions
): Promise<void> {
  if (memos.length === 1) {
    await exportAndShare(memos[0]!, format, options);
    return;
  }

  options?.onExportStarted?.();

  try {
    const uris: string[] = [];
    for (const memo of memos) {
      const file = await exportMemoToFile(memo, format);
      if (!file.exists) {
        throw new Error(`Export file was not created for “${memo.title}”.`);
      }
      uris.push(file.uri);
    }

    await shareFilesAsync(uris);
  } finally {
    options?.onExportFinished?.();
  }
}

function alertExportFailed(error: unknown): void {
  Alert.alert(
    'Export failed',
    error instanceof Error ? error.message : 'Unknown error'
  );
}

function runExport(
  memos: Memo[],
  format: ExportFormat,
  options?: ShareMemoOptions
): void {
  if (format === 'vmp' && options?.layerId) {
    Alert.alert('Export failed', 'Project export is only available for the full memo.');
    return;
  }

  void exportAndShareMany(memos, format, options).catch(alertExportFailed);
}

export function shareMemo(memo: Memo, options?: ShareMemoOptions): void {
  if (!hasRecording(memo)) {
    Alert.alert('Nothing to export', 'This memo has no recorded audio yet.');
    return;
  }

  if (options?.format === 'm4a' || options?.format === 'wav' || options?.format === 'vmp') {
    runExport([memo], options.format, options);
    return;
  }

  showFormatPicker(!options?.layerId, (format) => {
    void exportAndShare(memo, format, options).catch(alertExportFailed);
  });
}

export function shareMemos(memos: Memo[], options?: ShareMemoOptions): void {
  const exportable = memos.filter(hasRecording);
  if (exportable.length === 0) {
    Alert.alert('Nothing to export', 'Selected recordings have no recorded audio yet.');
    return;
  }

  if (options?.format === 'm4a' || options?.format === 'wav' || options?.format === 'vmp') {
    runExport(exportable, options.format, options);
    return;
  }

  showFormatPicker(true, (format) => {
    runExport(exportable, format, options);
  });
}
