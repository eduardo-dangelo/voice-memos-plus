import { ActionSheetIOS } from 'react-native';

export type MemoActionSheetHandlers = {
  onShare: () => void;
  onRename: () => void;
  onEditRecording?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export type MemoActionSheetOptions = MemoActionSheetHandlers & {
  includeEditRecording?: boolean;
};

export function showMemoActionSheet({
  includeEditRecording = true,
  onShare,
  onRename,
  onEditRecording,
  onDuplicate,
  onDelete,
}: MemoActionSheetOptions): void {
  const options = includeEditRecording
    ? (['Share', 'Rename', 'Edit Recording', 'Duplicate', 'Delete', 'Cancel'] as const)
    : (['Share', 'Rename', 'Duplicate', 'Delete', 'Cancel'] as const);

  const deleteIndex = options.indexOf('Delete');
  const cancelIndex = options.indexOf('Cancel');

  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: [...options],
      destructiveButtonIndex: deleteIndex,
      cancelButtonIndex: cancelIndex,
    },
    (index) => {
      const selected = options[index];
      switch (selected) {
        case 'Share':
          onShare();
          break;
        case 'Rename':
          onRename();
          break;
        case 'Edit Recording':
          onEditRecording?.();
          break;
        case 'Duplicate':
          onDuplicate();
          break;
        case 'Delete':
          onDelete();
          break;
      }
    }
  );
}
