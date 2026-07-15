import * as Sharing from 'expo-sharing';
import { ActionSheetIOS, Alert } from 'react-native';

import {
  exportMemoToFile,
  type ExportFormat,
} from '@/src/storage/memoStore';
import { hasRecording, type Memo } from '@/src/storage/types';

export type ShareMemoOptions = {
  onExportStarted?: () => void;
  onExportFinished?: () => void;
};

function getShareMimeType(format: ExportFormat): string {
  return format === 'm4a' ? 'audio/mp4' : 'audio/wav';
}

async function exportAndShare(
  memo: Memo,
  format: ExportFormat,
  options?: ShareMemoOptions
): Promise<void> {
  options?.onExportStarted?.();

  try {
    const file = await exportMemoToFile(memo, format);
    if (!file.exists) {
      throw new Error('Export file was not created.');
    }

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is not available on this device.');
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: getShareMimeType(format),
      UTI: format === 'm4a' ? 'public.mpeg-4-audio' : 'com.microsoft.waveform-audio',
    });
  } finally {
    options?.onExportFinished?.();
  }
}

function showFormatPicker(memo: Memo, options?: ShareMemoOptions): void {
  const sheetOptions = ['m4a', 'wav', 'Cancel'] as const;
  const cancelIndex = sheetOptions.indexOf('Cancel');

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Choose format…',
      options: [...sheetOptions],
      cancelButtonIndex: cancelIndex,
    },
    (index) => {
      const selected = sheetOptions[index];
      if (selected === 'm4a' || selected === 'wav') {
        void exportAndShare(memo, selected, options).catch((error) => {
          Alert.alert(
            'Share failed',
            error instanceof Error ? error.message : 'Unknown error'
          );
        });
      }
    }
  );
}

export function shareMemo(memo: Memo, options?: ShareMemoOptions): void {
  if (!hasRecording(memo)) {
    Alert.alert('Nothing to share', 'This memo has no recorded audio yet.');
    return;
  }

  showFormatPicker(memo, options);
}
