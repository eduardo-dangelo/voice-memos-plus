import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
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
import { WaveformView } from '@/src/components/WaveformView';
import {
  ensureWaveformPeaks,
  getMemo,
  replaceRecordingSegment,
  saveRecording,
  updateTitle,
} from '@/src/storage/memoStore';
import { getPrimaryLayerFile } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { hasRecording } from '@/src/storage/types';
import { formatDate, formatDuration, formatDurationWithTenths } from '@/src/utils/format';

export default function MemoEditorScreen() {
  const { id, record } = useLocalSearchParams<{ id: string; record?: string }>();
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const autoRecordStarted = useRef(false);

  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);

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
      if (hasRecording(loaded)) {
        const file = getPrimaryLayerFile(loaded);
        await engine.loadMemo(loaded.id, file.uri, loaded.duration, 0, loaded.duration);
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
      const { path, duration } = engine.stopRecording();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const updated = replaceMode
        ? await replaceRecordingSegment(memo.id, 0, memo.duration, path)
        : await saveRecording(memo.id, path, duration);
      setMemo(updated);
      setTitle(updated.title);
      setReplaceMode(false);
      const file = getPrimaryLayerFile(updated);
      await engine.loadMemo(updated.id, file.uri, updated.duration, 0, updated.duration);
    } catch (error) {
      Alert.alert('Could not save recording', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleReplace = async () => {
    if (!memo || !hasRecording(memo)) {
      return;
    }
    engine.pause();
    setReplaceMode(true);
    try {
      await engine.startRecording();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      setReplaceMode(false);
      Alert.alert('Recording failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (loading || !memo) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={VoiceMemosColors.accent} />
      </View>
    );
  }

  const isActiveMemo = engineState.memoId === memo.id;
  const duration =
    isActiveMemo && engineState.duration > 0 ? engineState.duration : memo.duration;
  const isRecording = engineState.isRecording;
  const currentTime = isActiveMemo ? engineState.currentTime : 0;

  const waveformDuration = isRecording
    ? Math.max(engineState.recordingDuration, 0.01)
    : duration;
  const waveformCurrentTime = isRecording ? engineState.recordingDuration : currentTime;
  const waveformPeaks = isRecording
    ? engineState.recordingPeaks.length > 0
      ? engineState.recordingPeaks
      : undefined
    : memo.layers[0]?.waveformPeaks;

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
          <Text style={styles.metaText}>
            {formatDate(memo.updatedAt)} · {formatDuration(isRecording ? engineState.recordingDuration : duration)}
          </Text>
        </View>

        <View style={styles.waveformSection}>
          <WaveformView
            currentTime={waveformCurrentTime}
            duration={waveformDuration}
            getPlaybackTime={() => engine.getPlaybackTime()}
            isPlaying={engineState.isPlaying}
            isRecording={isRecording}
            peaks={waveformPeaks}
            onSeek={(time) => {
              if (!isRecording) {
                engine.seek(time);
              }
            }}
          />
        </View>

        <View style={styles.timeDisplay}>
          <Text style={styles.largeTime}>
            {formatDurationWithTenths(isRecording ? engineState.recordingDuration : currentTime)}
          </Text>
        </View>

        {isRecording ? (
          <View style={styles.recordingPanel}>
            <Text style={styles.recordingLabel}>
              {replaceMode ? 'Recording replacement…' : 'Recording…'}
            </Text>
            <Text style={styles.recordingTime}>
              {formatDurationWithTenths(engineState.recordingDuration)}
            </Text>
            <Pressable onPress={() => void handleStopRecording()} style={styles.stopButton}>
              <View style={styles.stopSquare} />
            </Pressable>
          </View>
        ) : (
          <>
            <PlaybackControls
              currentTime={currentTime}
              duration={duration}
              isPlaying={engineState.isPlaying}
              showProgressBar={false}
              showTimeLabels={false}
              onPlayPause={() => void engine.togglePlayback()}
              onSkipBack={() => engine.skip(-15)}
              onSkipForward={() => engine.skip(15)}
            />
            <View style={styles.bottomBar}>
              <View style={styles.bottomSpacer} />
              <Pressable
                disabled={!hasRecording(memo)}
                onPress={() => void handleReplace()}
                style={[styles.replaceButton, !hasRecording(memo) && styles.replaceDisabled]}>
                <Text style={styles.replaceText}>REPLACE</Text>
              </Pressable>
              <View style={styles.bottomSpacer} />
            </View>
          </>
        )}
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
    gap: 20,
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
    gap: 4,
    paddingTop: 8,
  },
  titleInput: {
    fontSize: 28,
    fontWeight: '700',
    color: VoiceMemosColors.text,
    padding: 0,
  },
  metaText: {
    fontSize: 15,
    color: VoiceMemosColors.secondaryText,
  },
  waveformSection: {
    marginHorizontal: -20,
  },
  timeDisplay: {
    alignItems: 'center',
    gap: 4,
  },
  largeTime: {
    fontSize: 44,
    fontWeight: '300',
    color: VoiceMemosColors.text,
    fontVariant: ['tabular-nums'],
  },
  recordingPanel: {
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  recordingLabel: {
    fontSize: 17,
    color: VoiceMemosColors.secondaryText,
  },
  recordingTime: {
    fontSize: 32,
    color: VoiceMemosColors.text,
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: 16,
  },
  bottomSpacer: {
    flex: 1,
  },
  replaceButton: {
    backgroundColor: VoiceMemosColors.recordRed,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
  },
  replaceDisabled: {
    opacity: 0.4,
  },
  replaceText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
