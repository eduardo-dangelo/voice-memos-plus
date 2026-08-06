import { useMemo, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import {
  ThemedMenuView,
  type MenuAction,
} from '@/src/components/ThemedMenuView';

export type MemoOptionsMenuHandlers = {
  onShare: () => void;
  onRename: () => void;
  onEditRecording?: () => void;
  onMoveToFolder?: () => void;
  onMergeLayers?: () => void;
  onLockTracks?: () => void;
  onUnlockTracks?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export type MemoOptionsMenuProps = MemoOptionsMenuHandlers & {
  children: ReactNode;
  includeEditRecording?: boolean;
  includeMoveToFolder?: boolean;
  includeShare?: boolean;
  includeMergeLayers?: boolean;
  includeLockTracks?: boolean;
  includeUnlockTracks?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function MemoOptionsMenu({
  children,
  includeEditRecording = true,
  includeMoveToFolder = false,
  includeShare = true,
  includeMergeLayers = false,
  includeLockTracks = false,
  includeUnlockTracks = false,
  onShare,
  onRename,
  onEditRecording,
  onMoveToFolder,
  onMergeLayers,
  onLockTracks,
  onUnlockTracks,
  onDuplicate,
  onDelete,
  style,
}: MemoOptionsMenuProps) {
  const actions = useMemo((): MenuAction[] => {
    const items: MenuAction[] = [];
    if (includeShare) {
      items.push({ id: 'share', title: 'Export', image: 'square.and.arrow.up' });
    }
    items.push({ id: 'rename', title: 'Rename', image: 'pencil' });
    if (includeEditRecording) {
      items.push({ id: 'editRecording', title: 'Edit Recording', image: 'waveform' });
    }
    if (includeMoveToFolder) {
      items.push({ id: 'moveToFolder', title: 'Move to Folder', image: 'folder' });
    }
    if (includeMergeLayers) {
      items.push({ id: 'mergeLayers', title: 'Merge Layers', image: 'square.stack.3d.down.right' });
    }
    if (includeLockTracks) {
      items.push({ id: 'lockTracks', title: 'Lock Tracks', image: 'lock' });
    }
    if (includeUnlockTracks) {
      items.push({ id: 'unlockTracks', title: 'Unlock Tracks', image: 'lock.open' });
    }
    items.push({ id: 'duplicate', title: 'Duplicate', image: 'plus.square.on.square' });
    items.push({
      id: 'delete',
      title: 'Delete',
      image: 'trash',
      attributes: { destructive: true },
    });
    return items;
  }, [
    includeEditRecording,
    includeLockTracks,
    includeMergeLayers,
    includeMoveToFolder,
    includeShare,
    includeUnlockTracks,
  ]);

  return (
    <ThemedMenuView
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
          case 'mergeLayers':
            onMergeLayers?.();
            break;
          case 'lockTracks':
            onLockTracks?.();
            break;
          case 'unlockTracks':
            onUnlockTracks?.();
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
    </ThemedMenuView>
  );
}
