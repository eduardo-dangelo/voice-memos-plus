import * as Sharing from 'expo-sharing';
import { ActionSheetIOS, Alert } from 'react-native';

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

function showFormatPicker(memo: Memo, options?: ShareMemoOptions): void {
  const includeProject = !options?.layerId;
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
      void exportAndShare(memo, format, options).catch((error) => {
        Alert.alert(
          'Export failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      });
    }
  );
}

export function shareMemo(memo: Memo, options?: ShareMemoOptions): void {
  if (!hasRecording(memo)) {
    Alert.alert('Nothing to export', 'This memo has no recorded audio yet.');
    return;
  }

  if (options?.format === 'm4a' || options?.format === 'wav' || options?.format === 'vmp') {
    if (options.format === 'vmp' && options.layerId) {
      Alert.alert('Export failed', 'Project export is only available for the full memo.');
      return;
    }
    void exportAndShare(memo, options.format, options).catch((error) => {
      Alert.alert(
        'Export failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    });
    return;
  }

  showFormatPicker(memo, options);
}
