import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { useMemo, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type MemoOptionsMenuHandlers = {
  onShare: () => void;
  onRename: () => void;
  onEditRecording?: () => void;
  onMoveToFolder?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export type MemoOptionsMenuProps = MemoOptionsMenuHandlers & {
  children: ReactNode;
  includeEditRecording?: boolean;
  includeMoveToFolder?: boolean;
  includeShare?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function MemoOptionsMenu({
  children,
  includeEditRecording = true,
  includeMoveToFolder = false,
  includeShare = true,
  onShare,
  onRename,
  onEditRecording,
  onMoveToFolder,
  onDuplicate,
  onDelete,
  style,
}: MemoOptionsMenuProps) {
  const actions = useMemo((): MenuAction[] => {
    const items: MenuAction[] = [];
    if (includeShare) {
      items.push({ id: 'share', title: 'Share', image: 'square.and.arrow.up' });
    }
    items.push({ id: 'rename', title: 'Rename', image: 'pencil' });
    if (includeEditRecording) {
      items.push({ id: 'editRecording', title: 'Edit Recording', image: 'waveform' });
    }
    if (includeMoveToFolder) {
      items.push({ id: 'moveToFolder', title: 'Move to Folder', image: 'folder' });
    }
    items.push({ id: 'duplicate', title: 'Duplicate', image: 'plus.square.on.square' });
    items.push({
      id: 'delete',
      title: 'Delete',
      image: 'trash',
      attributes: { destructive: true },
    });
    return items;
  }, [includeEditRecording, includeMoveToFolder, includeShare]);

  return (
    <MenuView
      actions={actions}
      style={style}
      onPressAction={({ nativeEvent }) => {
        switch (nativeEvent.event) {
          case 'share':
            onShare();
            break;
          case 'rename':
            onRename();
            break;
          case 'editRecording':
            onEditRecording?.();
            break;
          case 'moveToFolder':
            onMoveToFolder?.();
            break;
          case 'duplicate':
            onDuplicate();
            break;
          case 'delete':
            onDelete();
            break;
        }
      }}>
      {children}
    </MenuView>
  );
}
