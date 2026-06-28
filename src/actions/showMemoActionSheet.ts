import { ActionSheetIOS } from 'react-native';

export type MemoActionSheetHandlers = {
  onShare: () => void;
  onRename: () => void;
  onEditRecording?: () => void;
  onMoveToFolder?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export type MemoActionSheetOptions = MemoActionSheetHandlers & {
  includeEditRecording?: boolean;
  includeMoveToFolder?: boolean;
};

export function showMemoActionSheet({
  includeEditRecording = true,
  includeMoveToFolder = false,
  onShare,
  onRename,
  onEditRecording,
  onMoveToFolder,
  onDuplicate,
  onDelete,
}: MemoActionSheetOptions): void {
  const options = [
    'Share',
    'Rename',
    ...(includeEditRecording ? (['Edit Recording'] as const) : []),
    ...(includeMoveToFolder ? (['Move to Folder'] as const) : []),
    'Duplicate',
    'Delete',
    'Cancel',
  ] as const;

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
        case 'Move to Folder':
          onMoveToFolder?.();
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
