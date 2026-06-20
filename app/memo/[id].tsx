import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import { PlaybackControls } from '@/src/components/PlaybackControls';
import { WaveformView, type TrackData } from '@/src/components/WaveformView';
import {
  addStackedLayer,
  ensureWaveformPeaks,
  getMemo,
  replaceLayerSegment,
  saveRecording,
  updateTitle,
} from '@/src/storage/memoStore';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { getMemoTimelineDuration, hasRecording } from '@/src/storage/types';
import { formatDurationWithTenths } from '@/src/utils/format';

async function loadMemoIntoEngine(
  engine: ReturnType<typeof useAudioEngine>,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  const { layers, duration, trimStart, trimEnd } = getMemoPlaybackTimeline(memo);
  await engine.loadMemo(memo.id, layers, trimStart, trimEnd, duration);
  if (seekTime !== undefined) {
    engine.seek(seekTime);
  }
}

export default function MemoEditorScreen() {
  const { id, record } = useLocalSearchParams<{ id: string; record?: string }>();
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const autoRecordStarted = useRef(false);
  const recordingStartTime = useRef(0);

  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [stackMode, setStackMode] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const loadMemo = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    const next = await getMemo(id);
    const loaded = next && hasRecording(next) ? await ensureWaveformPeaks(next) : next;
    setMemo(loaded);
    if (loaded) {
      setTitle(loaded.title);
      setActiveLayerId(loaded.layers[0]?.id ?? null);
      if (hasRecording(loaded)) {
        await loadMemoIntoEngine(engine, loaded);
      }
    }
    setLoading(false);
  }, [engine, id]);

  useEffect(() => {
    void loadMemo();
    return () => {
      engine.pause();
    };
  }, [engine, loadMemo]);

  useEffect(() => {
    if (autoRecordStarted.current) {
      return;
    }
    if (record !== '1' || !memo || hasRecording(memo)) {
      return;
    }

    autoRecordStarted.current = true;
    router.setParams({ record: undefined });
    void engine.startRecording().catch((error: Error) => {
      Alert.alert('Recording failed', error.message);
    });
  }, [engine, memo, record]);

  const handleDone = useCallback(async () => {
    if (!memo) {
      return;
    }
    engine.pause();
    if (title.trim() && title !== memo.title) {
      await updateTitle(memo.id, title);
    }
    router.back();
  }, [engine, memo, title]);

  const renderDoneButton = useCallback(
    () => (
      <Pressable onPress={() => void handleDone()} style={styles.doneButton}>
        <SymbolView name={{ ios: 'checkmark' }} size={22} tintColor="#FFFFFF" />
      </Pressable>
    ),
    [handleDone],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '',
      ...(Platform.OS === 'ios'
        ? {
            unstable_headerRightItems: () => [
              {
                type: 'custom' as const,
                hidesSharedBackground: true,
                element: renderDoneButton(),
              },
            ],
          }
        : {
            headerRight: renderDoneButton,
          }),
    });
  }, [navigation, renderDoneButton]);

  const handleStopRecording = async () => {
    if (!memo || !engineState.isRecording) {
      return;
    }
    try {
      const { path, duration, peaks } = engine.stopRecording();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const wasStackMode = stackMode;
      const wasReplaceMode = replaceMode;
      const capturedStartTime = recordingStartTime.current;

      let updated: Memo;
      if (wasStackMode) {
        updated = await addStackedLayer(memo.id, capturedStartTime, path, peaks);
        setActiveLayerId(updated.layers[updated.layers.length - 1]?.id ?? activeLayerId);
      } else if (wasReplaceMode) {
        const activeLayer = memo.layers.find((layer) => layer.id === activeLayerId) ?? memo.layers[0];
        if (!activeLayer) {
          throw new Error('No active layer');
        }
        const relativeStart = Math.max(0, capturedStartTime - activeLayer.startTime);
        const relativeEnd = relativeStart + duration;
        updated = await replaceLayerSegment(
          memo.id,
          activeLayer.id,
          relativeStart,
          relativeEnd,
          path,
          peaks
        );
      } else {
        updated = await saveRecording(memo.id, path, duration, peaks);
        setActiveLayerId(updated.layers[0]?.id ?? null);
      }

      setMemo(updated);
      setTitle(updated.title);
      setReplaceMode(false);
      setStackMode(false);
      await loadMemoIntoEngine(
        engine,
        updated,
        wasStackMode || wasReplaceMode ? capturedStartTime : 0
      );
    } catch (error) {
      Alert.alert('Could not save recording', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const beginRecording = async (mode: 'replace' | 'stack') => {
    if (!memo || !hasRecording(memo)) {
      return;
    }

    engine.pause();
    recordingStartTime.current = engine.getPlaybackTime();
    setReplaceMode(mode === 'replace');
    setStackMode(mode === 'stack');

    try {
      await engine.startRecording();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      setReplaceMode(false);
      setStackMode(false);
      Alert.alert('Recording failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleReplace = () => void beginRecording('replace');
  const handleStack = () => void beginRecording('stack');

  const showRecordOptions = () => {
    if (!memo || !hasRecording(memo)) {
      return;
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Stack', 'Replace', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) {
          handleStack();
        } else if (index === 1) {
          handleReplace();
        }
      }
    );
  };

  const isActiveMemo = engineState.memoId === memo?.id;
  const timelineDuration = memo ? getMemoTimelineDuration(memo) : 0;
  const duration =
    memo && isActiveMemo && engineState.duration > 0
      ? engineState.duration
      : timelineDuration;
  const isRecording = engineState.isRecording;
  const currentTime = memo && isActiveMemo ? engineState.currentTime : 0;

  const waveformDuration = isRecording
    ? Math.max(duration, recordingStartTime.current + engineState.recordingDuration, 0.01)
    : duration;
  const waveformCurrentTime = isRecording
    ? recordingStartTime.current + engineState.recordingDuration
    : currentTime;

  const waveformTracks = useMemo((): TrackData[] => {
    if (!memo) {
      return [];
    }

    const playableTracks = [...memo.layers]
      .filter((layer) => layer.duration > 0)
      .sort((a, b) => b.order - a.order)
      .map((layer) => ({
        id: layer.id,
        peaks: layer.waveformPeaks,
        startTime: layer.startTime,
        duration: layer.duration,
        isActive: layer.id === activeLayerId,
      }));

    if (isRecording && (replaceMode || stackMode)) {
      const recordingTrack: TrackData = {
        id: '__recording__',
        peaks:
          engineState.recordingPeaks.length > 0 ? engineState.recordingPeaks : undefined,
        startTime: recordingStartTime.current,
        duration: engineState.recordingDuration,
        isActive: true,
      };
      return [recordingTrack, ...playableTracks.map((track) => ({ ...track, isActive: false }))];
    }

    if (playableTracks.length === 0) {
      return [
        {
          id: memo.layers[0]?.id ?? 'empty',
          peaks: undefined,
          startTime: 0,
          duration: duration > 0 ? duration : 0.01,
          isActive: true,
        },
      ];
    }

    return playableTracks;
  }, [
    activeLayerId,
    duration,
    engineState.recordingDuration,
    engineState.recordingPeaks,
    isRecording,
    memo,
    replaceMode,
    stackMode,
  ]);

  if (loading || !memo) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={VoiceMemosColors.accent} />
      </View>
    );
  }

  const recordingLabel = stackMode
    ? 'Recording stack…'
    : replaceMode
      ? 'Recording replacement…'
      : 'Recording…';

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.headerMeta}>
          <TextInput
            multiline={false}
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <View style={styles.tracksArea}>
          <WaveformView
            currentTime={waveformCurrentTime}
            duration={waveformDuration}
            getPlaybackTime={() => engine.getPlaybackTime()}
            isPlaying={engineState.isPlaying}
            isRecording={isRecording}
            tracks={waveformTracks}
            onSeek={(time) => {
              if (!isRecording) {
                engine.seek(time);
              }
            }}
            onTrackPress={setActiveLayerId}
          />
        </View>

        <View style={styles.footer}>
          <View style={styles.timeDisplay}>
            <Text style={styles.largeTime}>
              {formatDurationWithTenths(isRecording ? engineState.recordingDuration : currentTime)}
            </Text>
            {isRecording ? (
              <Text style={styles.recordingLabel}>{recordingLabel}</Text>
            ) : null}
          </View>

          {isRecording ? (
            <Pressable onPress={() => void handleStopRecording()} style={styles.stopButton}>
              <View style={styles.stopSquare} />
            </Pressable>
          ) : (
            <PlaybackControls
              currentTime={currentTime}
              duration={duration}
              isPlaying={engineState.isPlaying}
              recordDisabled={!hasRecording(memo)}
              showProgressBar={false}
              showTimeLabels={false}
              onPlayPause={() => void engine.togglePlayback()}
              onRecordPress={showRecordOptions}
              onSkipBack={() => engine.skip(-15)}
              onSkipForward={() => engine.skip(15)}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VoiceMemosColors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VoiceMemosColors.background,
  },
  doneButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: VoiceMemosColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  headerMeta: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  titleInput: {
    fontSize: 28,
    fontWeight: '700',
    color: VoiceMemosColors.text,
    padding: 0,
  },
  tracksArea: {
    flex: 1,
    marginHorizontal: -20,
  },
  timeDisplay: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 4,
  },
  largeTime: {
    fontSize: 36,
    fontWeight: '300',
    color: VoiceMemosColors.text,
    fontVariant: ['tabular-nums'],
  },
  recordingLabel: {
    fontSize: 15,
    color: VoiceMemosColors.secondaryText,
  },
  footer: {
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: VoiceMemosColors.separator,
  },
  stopButton: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: VoiceMemosColors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: VoiceMemosColors.recordRed,
  },
});
