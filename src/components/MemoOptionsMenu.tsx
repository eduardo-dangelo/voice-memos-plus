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
  onMuteTracks?: () => void;
  onUnmuteTracks?: () => void;
  onSoloTracks?: () => void;
  onUnsoloTracks?: () => void;
  onLockTracks?: () => void;
  onUnlockTracks?: () => void;
  onDuplicate: () => void;
  onRefresh?: () => void;
  onDelete: () => void;
};

export type MemoOptionActionFlags = {
  includeEditRecording?: boolean;
  includeMoveToFolder?: boolean;
  includeShare?: boolean;
  includeMergeLayers?: boolean;
  includeMuteTracks?: boolean;
  includeUnmuteTracks?: boolean;
  includeSoloTracks?: boolean;
  includeUnsoloTracks?: boolean;
  includeLockTracks?: boolean;
  includeUnlockTracks?: boolean;
  includeRefresh?: boolean;
};

export type MemoOptionAction = {
  id: string;
  title: string;
  systemImage: string;
  destructive?: boolean;
};

export type MemoOptionsMenuProps = MemoOptionsMenuHandlers &
  MemoOptionActionFlags & {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
  };

/** Shared action list for native Menu and IconActionSheet call sites. */
export function buildMemoOptionActions({
  includeEditRecording = true,
  includeMoveToFolder = false,
  includeShare = true,
  includeMergeLayers = false,
  includeMuteTracks = false,
  includeUnmuteTracks = false,
  includeSoloTracks = false,
  includeUnsoloTracks = false,
  includeLockTracks = false,
  includeUnlockTracks = false,
  includeRefresh = false,
}: MemoOptionActionFlags = {}): MemoOptionAction[] {
  const items: MemoOptionAction[] = [];
  if (includeShare) {
    items.push({ id: 'share', title: 'Export', systemImage: 'square.and.arrow.up' });
  }
  items.push({ id: 'rename', title: 'Rename', systemImage: 'pencil' });
  if (includeEditRecording) {
    items.push({ id: 'editRecording', title: 'Edit Recording', systemImage: 'waveform' });
  }
  if (includeMoveToFolder) {
    items.push({ id: 'moveToFolder', title: 'Move to Folder', systemImage: 'folder' });
  }
  if (includeMergeLayers) {
    items.push({
      id: 'mergeLayers',
      title: 'Merge Layers',
      systemImage: 'square.stack.3d.down.right',
    });
  }
  if (includeMuteTracks) {
    items.push({ id: 'muteTracks', title: 'Mute Tracks', systemImage: 'speaker.slash' });
  }
  if (includeUnmuteTracks) {
    items.push({ id: 'unmuteTracks', title: 'Unmute Tracks', systemImage: 'speaker.wave.2' });
  }
  if (includeSoloTracks) {
    items.push({ id: 'soloTracks', title: 'Solo Tracks', systemImage: 'headphones' });
  }
  if (includeUnsoloTracks) {
    items.push({ id: 'unsoloTracks', title: 'Unsolo Tracks', systemImage: 'headphones' });
  }
  if (includeLockTracks) {
    items.push({ id: 'lockTracks', title: 'Lock Tracks', systemImage: 'lock' });
  }
  if (includeUnlockTracks) {
    items.push({ id: 'unlockTracks', title: 'Unlock Tracks', systemImage: 'lock.open' });
  }
  items.push({ id: 'duplicate', title: 'Duplicate', systemImage: 'plus.square.on.square' });
  if (includeRefresh) {
    items.push({ id: 'refresh', title: 'Refresh', systemImage: 'arrow.clockwise' });
  }
  items.push({
    id: 'delete',
    title: 'Delete',
    systemImage: 'trash',
    destructive: true,
  });
  return items;
}

function toMenuActions(items: MemoOptionAction[]): MenuAction[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    image: item.systemImage,
    attributes: item.destructive ? { destructive: true } : undefined,
  }));
}

export function MemoOptionsMenu({
  children,
  includeEditRecording = true,
  includeMoveToFolder = false,
  includeShare = true,
  includeMergeLayers = false,
  includeMuteTracks = false,
  includeUnmuteTracks = false,
  includeSoloTracks = false,
  includeUnsoloTracks = false,
  includeLockTracks = false,
  includeUnlockTracks = false,
  includeRefresh = false,
  onShare,
  onRename,
  onEditRecording,
  onMoveToFolder,
  onMergeLayers,
  onMuteTracks,
  onUnmuteTracks,
  onSoloTracks,
  onUnsoloTracks,
  onLockTracks,
  onUnlockTracks,
  onDuplicate,
  onRefresh,
  onDelete,
  style,
}: MemoOptionsMenuProps) {
  const actions = useMemo(
    (): MenuAction[] =>
      toMenuActions(
        buildMemoOptionActions({
          includeEditRecording,
          includeMoveToFolder,
          includeShare,
          includeMergeLayers,
          includeMuteTracks,
          includeUnmuteTracks,
          includeSoloTracks,
          includeUnsoloTracks,
          includeLockTracks,
          includeUnlockTracks,
          includeRefresh,
        })
      ),
    [
      includeEditRecording,
      includeLockTracks,
      includeMergeLayers,
      includeMoveToFolder,
      includeMuteTracks,
      includeRefresh,
      includeShare,
      includeSoloTracks,
      includeUnlockTracks,
      includeUnmuteTracks,
      includeUnsoloTracks,
    ]
  );

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
          case 'muteTracks':
            onMuteTracks?.();
            break;
          case 'unmuteTracks':
            onUnmuteTracks?.();
            break;
          case 'soloTracks':
            onSoloTracks?.();
            break;
          case 'unsoloTracks':
            onUnsoloTracks?.();
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
          case 'refresh':
            onRefresh?.();
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
