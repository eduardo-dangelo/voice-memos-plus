import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { LIST_ITEM_EXIT, LIST_ITEM_TRANSITION } from '@/src/components/listTransitions';
import { MiniWaveformTracks } from '@/src/components/MiniWaveformTracks';
import { NamePromptDialog } from '@/src/components/NamePromptDialog';

import { shareMemo } from '@/src/actions/shareMemo';
import { showMoveToFolderActionSheet } from '@/src/actions/showMoveToFolderActionSheet';
import { useAudioEngine, useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import { useIsRegularWidth } from '@/src/hooks/useIsRegularWidth';
import {
  deleteMemo,
  duplicateMemo,
  permanentlyDeleteMemo,
  updateTitle,
} from '@/src/storage/memoStore';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { hasRecording } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDate, formatDuration } from '@/src/utils/format';

import { Collapsible } from './Collapsible';
import { MemoOptionsMenu } from './MemoOptionsMenu';
import { PlaybackControls } from './PlaybackControls';

type Props = {
  memo: Memo;
  expanded: boolean;
  selected: boolean;
  selectionMode: boolean;
  /** Highlighted as the detail-pane selection (sidebar layout). */
  active?: boolean;
  /** When true, primary tap selects into the detail pane instead of expanding. */
  selectOnPress?: boolean;
  allowMoveToFolder?: boolean;
  isTrash?: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onOpenEditor: () => void;
  onDeleted: (memoId: string) => void;
  onDeleteFailed: () => void;
  onUpdated: () => void;
};

type RowPlaybackSlice = {
  isActive: boolean;
  currentTime: number;
  isPlaying: boolean;
  duration: number;
};

const INACTIVE_PLAYBACK: RowPlaybackSlice = {
  isActive: false,
  currentTime: 0,
  isPlaying: false,
  duration: 0,
};

function areRowPlaybackSlicesEqual(a: RowPlaybackSlice, b: RowPlaybackSlice): boolean {
  return (
    a.isActive === b.isActive &&
    a.currentTime === b.currentTime &&
    a.isPlaying === b.isPlaying &&
    a.duration === b.duration
  );
}

/** Hot playback subscription — only the active memo row re-renders on time ticks. */
function useRowPlayback(memoId: string): RowPlaybackSlice {
  return useAudioEngineSelector((state): RowPlaybackSlice => {
    if (state.memoId !== memoId) {
      return INACTIVE_PLAYBACK;
    }
    return {
      isActive: true,
      currentTime: state.currentTime,
      isPlaying: state.isPlaying,
      duration: state.duration,
    };
  }, areRowPlaybackSlicesEqual);
}

function RecordingRowComponent({
  memo,
  expanded,
  selected,
  selectionMode,
  active = false,
  selectOnPress = false,
  allowMoveToFolder = false,
  isTrash = false,
  onToggleExpand,
  onToggleSelect,
  onOpenEditor,
  onDeleted,
  onDeleteFailed,
  onUpdated,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const isRegularWidth = useIsRegularWidth();
  const engine = useAudioEngine();
  const playback = useRowPlayback(memo.id);
  const [isExporting, setIsExporting] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const isActive = playback.isActive;
  const duration =
    isActive && playback.duration > 0 ? playback.duration : memo.duration;
  const playable = hasRecording(memo);
  const displayTime = isActive ? playback.currentTime : 0;
  const wasExpandedRef = useRef(expanded);

  useEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (wasExpanded && !expanded && isActive) {
      engine.pause();
    }
  }, [expanded, isActive, engine]);

  const ensureLoaded = async () => {
    if (!playable) {
      return false;
    }
    if (!isActive) {
      const { layers, duration: timelineDuration, trimStart, trimEnd } =
        getMemoPlaybackTimeline(memo);
      await engine.loadMemo(memo.id, memo.title, layers, trimStart, trimEnd, timelineDuration);
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

  const handleShare = () => {
    shareMemo(memo, {
      onExportStarted: () => setIsExporting(true),
      onExportFinished: () => setIsExporting(false),
    });
  };

  const handleRename = () => {
    setRenameVisible(true);
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
            onDeleted(memo.id);
            const action = isTrash ? permanentlyDeleteMemo : deleteMemo;
            void action(memo.id).catch(() => {
              onDeleteFailed();
            });
          },
        },
      ]
    );
  };

  const handlePrimaryPress = () => {
    if (selectionMode) {
      onToggleSelect();
      return;
    }
    if (selectOnPress) {
      onOpenEditor();
      return;
    }
    onToggleExpand();
  };

  return (
    <>
      <Animated.View
      exiting={LIST_ITEM_EXIT}
      layout={LIST_ITEM_TRANSITION}
      style={[styles.container, active && styles.containerActive]}>
      <View style={styles.row}>
        <Pressable
          onPress={handlePrimaryPress}
          onLongPress={selectOnPress ? undefined : onOpenEditor}
          style={styles.rowMain}>
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
        </Pressable>
        {!selectionMode ? (
          <MemoOptionsMenu
            includeMoveToFolder={allowMoveToFolder}
            includeShare={playable}
            onShare={handleShare}
            onRename={handleRename}
            onEditRecording={onOpenEditor}
            onMoveToFolder={() =>
              void showMoveToFolderActionSheet(memo.id, memo.folderId, onUpdated)
            }
            onDuplicate={() => void duplicateMemo(memo.id).then(onUpdated)}
            onDelete={confirmDelete}>
            <View style={styles.moreButton}>
              <SymbolView name={{ ios: 'ellipsis' }} size={22} tintColor={colors.secondaryText} />
            </View>
          </MemoOptionsMenu>
        ) : null}
      </View>

      {playable ? (
        <Collapsible expanded={expanded}>
          <View style={styles.expanded}>
            {!isRegularWidth ? (
              <Pressable accessibilityLabel="Edit Recording" onPress={onOpenEditor}>
                <MiniWaveformTracks
                  currentTime={displayTime}
                  duration={duration}
                  memo={memo}
                />
              </Pressable>
            ) : null}
            <PlaybackControls
              compact
              currentTime={displayTime}
              duration={duration}
              showProgressBar={false}
              isPlaying={isActive && playback.isPlaying}
              onPlayPause={() => void handlePlayPause()}
              onSkipBack={() => void handleSkip(-15)}
              onSkipForward={() => void handleSkip(15)}
            />
            <View style={styles.actionRow}>
              <Pressable
                accessibilityLabel="Edit Recording"
                hitSlop={12}
                onPress={onOpenEditor}
                style={styles.editButton}>
                <SymbolView name={{ ios: 'waveform' }} size={22} tintColor={colors.accent} />
              </Pressable>
              <Pressable hitSlop={12} onPress={confirmDelete} style={styles.deleteButton}>
                <SymbolView name={{ ios: 'trash' }} size={22} tintColor={colors.accent} />
              </Pressable>
            </View>
          </View>
        </Collapsible>
      ) : null}
    </Animated.View>
      <NamePromptDialog
        initialValue={memo.title}
        title="Rename Recording"
        visible={renameVisible}
        onCancel={() => setRenameVisible(false)}
        onSave={(value) => {
          setRenameVisible(false);
          if (value.trim()) {
            void updateTitle(memo.id, value.trim()).then(onUpdated);
          }
        }}
      />
      <Modal animationType="fade" transparent visible={isExporting}>
        <View style={styles.exportOverlay}>
          <View style={styles.exportCard}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.exportText}>Preparing audio…</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const RecordingRow = memo(RecordingRowComponent);

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          overflow: 'hidden',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.separator,
          backgroundColor: colors.background,
        },
        containerActive: {
          backgroundColor: colors.pillBackground,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        rowMain: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
        },
        moreButton: {
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          marginVertical: -10,
          marginHorizontal: -10,
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
        editButton: {
          alignSelf: 'flex-start',
        },
        deleteButton: {
          alignSelf: 'center',
        },
        exportOverlay: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
        },
        exportCard: {
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 24,
          paddingVertical: 20,
          borderRadius: 14,
          backgroundColor: colors.background,
        },
        exportText: {
          fontSize: 16,
          color: colors.text,
        },
      }),
    [colors]
  );
}
