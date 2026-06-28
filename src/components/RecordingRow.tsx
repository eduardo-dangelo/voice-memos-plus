import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { showMoveToFolderActionSheet } from '@/src/actions/showMoveToFolderActionSheet';
import { showMemoActionSheet } from '@/src/actions/showMemoActionSheet';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import {
  deleteMemo,
  duplicateMemo,
  getShareableFile,
  permanentlyDeleteMemo,
  updateTitle,
} from '@/src/storage/memoStore';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { hasRecording } from '@/src/storage/types';
import { formatDate, formatDuration } from '@/src/utils/format';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import * as Sharing from 'expo-sharing';

import { Collapsible } from './Collapsible';
import { PlaybackControls } from './PlaybackControls';

type Props = {
  memo: Memo;
  expanded: boolean;
  selected: boolean;
  selectionMode: boolean;
  allowMoveToFolder?: boolean;
  isTrash?: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onOpenEditor: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
};

export function RecordingRow({
  memo,
  expanded,
  selected,
  selectionMode,
  allowMoveToFolder = false,
  isTrash = false,
  onToggleExpand,
  onToggleSelect,
  onOpenEditor,
  onDeleted,
  onUpdated,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const isActive = engineState.memoId === memo.id;
  const duration =
    isActive && engineState.duration > 0
      ? engineState.duration
      : memo.duration;
  const playable = hasRecording(memo);

  const displayTime = useMemo(() => {
    if (isActive) {
      return engineState.currentTime;
    }
    return 0;
  }, [engineState.currentTime, isActive]);

  const ensureLoaded = async () => {
    if (!playable) {
      return false;
    }
    if (!isActive) {
      const { layers, duration: timelineDuration, trimStart, trimEnd } =
        getMemoPlaybackTimeline(memo);
      await engine.loadMemo(memo.id, layers, trimStart, trimEnd, timelineDuration);
    } else {
      engine.setLoopEnabled(false);
    }
    return true;
  };

  const handlePlayPause = async () => {
    if (!(await ensureLoaded())) {
      return;
    }
    try {
      await engine.togglePlayback();
    } catch (error) {
      Alert.alert(
        'Playback failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const handleSkip = async (seconds: number) => {
    if (!(await ensureLoaded())) {
      return;
    }
    engine.skip(seconds);
  };

  const handleShare = async () => {
    const file = await getShareableFile(memo);
    if (!file.exists) {
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri);
    }
  };

  const handleRename = () => {
    Alert.prompt('Rename Recording', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value?: string) => {
          if (value?.trim()) {
            void updateTitle(memo.id, value.trim()).then(onUpdated);
          }
        },
      },
    ], 'plain-text', memo.title);
  };

  const confirmDelete = () => {
    Alert.alert(
      isTrash ? 'Delete Recording' : 'Delete Recording',
      isTrash
        ? 'This recording will be permanently deleted.'
        : 'This recording will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (isActive) {
              engine.unload();
            }
            const action = isTrash ? permanentlyDeleteMemo : deleteMemo;
            void action(memo.id).then(onDeleted);
          },
        },
      ]
    );
  };

  const showMenu = () => {
    showMemoActionSheet({
      includeMoveToFolder: allowMoveToFolder,
      onShare: () => void handleShare(),
      onRename: handleRename,
      onEditRecording: onOpenEditor,
      onMoveToFolder: () => void showMoveToFolderActionSheet(memo.id, memo.folderId, onUpdated),
      onDuplicate: () => void duplicateMemo(memo.id).then(onUpdated),
      onDelete: confirmDelete,
    });
  };

  return (
    <Animated.View layout={LinearTransition.duration(40)} style={styles.container}>
      <Pressable
        onPress={selectionMode ? onToggleSelect : onToggleExpand}
        onLongPress={onOpenEditor}
        style={styles.row}>
        {selectionMode ? (
          <SymbolView
            name={{ ios: selected ? 'checkmark.circle.fill' : 'circle' }}
            size={22}
            tintColor={selected ? colors.accent : colors.secondaryText}
          />
        ) : null}
        <View style={styles.meta}>
          <Text numberOfLines={1} style={styles.title}>
            {memo.title}
          </Text>
          <Text style={styles.subtitle}>
            {formatDate(memo.updatedAt)} · {formatDuration(duration)}
          </Text>
        </View>
        {!selectionMode ? (
          <Pressable hitSlop={12} onPress={showMenu}>
            <SymbolView name={{ ios: 'ellipsis' }} size={18} tintColor={colors.secondaryText} />
          </Pressable>
        ) : null}
      </Pressable>

      {playable ? (
        <Collapsible expanded={expanded}>
          <View style={styles.expanded}>
            <PlaybackControls
              compact
              currentTime={isActive ? displayTime : 0}
              duration={duration}
              isPlaying={isActive && engineState.isPlaying}
              onPlayPause={() => void handlePlayPause()}
              onSkipBack={() => void handleSkip(-15)}
              onSkipForward={() => void handleSkip(15)}
            />
            <View style={styles.actionRow}>
              <Pressable onPress={onOpenEditor} style={styles.editLink}>
                <Text style={styles.editLinkText}>Edit Recording</Text>
              </Pressable>
              <Pressable hitSlop={12} onPress={confirmDelete} style={styles.deleteButton}>
                <SymbolView name={{ ios: 'trash' }} size={18} tintColor={colors.secondaryText} />
              </Pressable>
            </View>
          </View>
        </Collapsible>
      ) : null}
    </Animated.View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.separator,
          backgroundColor: colors.background,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        meta: {
          flex: 1,
          gap: 2,
        },
        title: {
          fontSize: 17,
          fontWeight: '500',
          color: colors.text,
        },
        subtitle: {
          fontSize: 14,
          color: colors.secondaryText,
        },
        expanded: {
          paddingHorizontal: 16,
          paddingBottom: 16,
          gap: 12,
        },
        actionRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        editLink: {
          alignSelf: 'flex-start',
        },
        deleteButton: {
          alignSelf: 'center',
        },
        editLinkText: {
          color: colors.accent,
          fontSize: 15,
        },
      }),
    [colors]
  );
}
