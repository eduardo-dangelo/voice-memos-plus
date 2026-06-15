import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import { getPrimaryLayerFile } from '@/src/storage/paths';
import {
  deleteMemo,
  duplicateMemo,
  getShareableFile,
  updateTitle,
} from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';
import { hasRecording } from '@/src/storage/types';
import { formatDate, formatDuration } from '@/src/utils/format';
import * as Sharing from 'expo-sharing';

import { PlaybackControls } from './PlaybackControls';

type Props = {
  memo: Memo;
  expanded: boolean;
  selected: boolean;
  selectionMode: boolean;
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
  onToggleExpand,
  onToggleSelect,
  onOpenEditor,
  onDeleted,
  onUpdated,
}: Props) {
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const isActive = engineState.memoId === memo.id;
  const duration =
    isActive && engineState.duration > 0 ? engineState.duration : memo.duration;
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
      const file = getPrimaryLayerFile(memo);
      await engine.loadMemo(memo.id, file.uri, memo.duration, 0, memo.duration);
    }
    return true;
  };

  const handlePlayPause = async () => {
    if (!(await ensureLoaded())) {
      return;
    }
    await engine.togglePlayback();
  };

  const handleSkip = async (seconds: number) => {
    if (!(await ensureLoaded())) {
      return;
    }
    engine.skip(seconds);
  };

  const handleShare = async () => {
    const file = getShareableFile(memo);
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

  const showMenu = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Share', 'Rename', 'Edit Recording', 'Duplicate', 'Delete', 'Cancel'],
        destructiveButtonIndex: 4,
        cancelButtonIndex: 5,
      },
      (index) => {
        switch (index) {
          case 0:
            void handleShare();
            break;
          case 1:
            handleRename();
            break;
          case 2:
            onOpenEditor();
            break;
          case 3:
            void duplicateMemo(memo.id).then(onUpdated);
            break;
          case 4:
            Alert.alert('Delete Recording', 'This recording will be deleted.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  if (isActive) {
                    engine.unload();
                  }
                  void deleteMemo(memo.id).then(onDeleted);
                },
              },
            ]);
            break;
        }
      }
    );
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={selectionMode ? onToggleSelect : onToggleExpand}
        onLongPress={onOpenEditor}
        style={styles.row}>
        {selectionMode ? (
          <SymbolView
            name={{ ios: selected ? 'checkmark.circle.fill' : 'circle' }}
            size={22}
            tintColor={selected ? VoiceMemosColors.accent : VoiceMemosColors.secondaryText}
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
            <SymbolView name={{ ios: 'ellipsis' }} size={18} tintColor={VoiceMemosColors.secondaryText} />
          </Pressable>
        ) : null}
      </Pressable>

      {expanded && playable ? (
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
          <Pressable onPress={onOpenEditor} style={styles.editLink}>
            <Text style={styles.editLinkText}>Edit Recording</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: VoiceMemosColors.separator,
    backgroundColor: VoiceMemosColors.background,
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
    color: VoiceMemosColors.text,
  },
  subtitle: {
    fontSize: 14,
    color: VoiceMemosColors.secondaryText,
  },
  expanded: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  editLink: {
    alignSelf: 'flex-start',
  },
  editLinkText: {
    color: VoiceMemosColors.accent,
    fontSize: 15,
  },
});
