import * as Haptics from 'expo-haptics';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { TrimHandles } from '@/src/components/TrimHandles';
import { WaveformView } from '@/src/components/WaveformView';
import { getPrimaryLayerFile } from '@/src/storage/paths';
import {
  ensureWaveformPeaks,
  getMemo,
  replaceRecordingSegment,
  saveRecording,
  updateTitle,
  updateTrim,
} from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';
import { hasRecording } from '@/src/storage/types';
import { formatDate, formatDuration } from '@/src/utils/format';

export default function MemoEditorScreen() {
  const { id, record } = useLocalSearchParams<{ id: string; record?: string }>();
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const autoRecordStarted = useRef(false);

  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [waveformWidth, setWaveformWidth] = useState(0);
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
      setTrimStart(loaded.trimStart);
      setTrimEnd(loaded.trimEnd || loaded.duration);
      if (hasRecording(loaded)) {
        const file = getPrimaryLayerFile(loaded);
        await engine.loadMemo(
          loaded.id,
          file.uri,
          loaded.duration,
          loaded.trimStart,
          loaded.trimEnd || loaded.duration
        );
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
    await updateTrim(memo.id, trimStart, trimEnd);
    router.back();
  }, [engine, memo, title, trimEnd, trimStart]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => void handleDone()} style={styles.doneButton}>
          <SymbolView name={{ ios: 'checkmark' }} size={22} tintColor={VoiceMemosColors.accent} />
        </Pressable>
      ),
    });
  }, [handleDone, navigation, title, trimEnd, trimStart, memo]);

  const handleStopRecording = async () => {
    if (!memo || !engineState.isRecording) {
      return;
    }
    try {
      const { path, duration, peaks: capturedPeaks } = engine.stopRecording();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const peaksToSave =
        !replaceMode && capturedPeaks.length > 0 ? capturedPeaks : undefined;
      const updated = replaceMode
        ? await replaceRecordingSegment(memo.id, trimStart, trimEnd, path)
        : await saveRecording(memo.id, path, duration, peaksToSave);
      setMemo(updated);
      setTitle(updated.title);
      setTrimStart(updated.trimStart);
      setTrimEnd(updated.trimEnd);
      setReplaceMode(false);
      const file = getPrimaryLayerFile(updated);
      await engine.loadMemo(
        updated.id,
        file.uri,
        updated.duration,
        updated.trimStart,
        updated.trimEnd
      );
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

  const handleTrimChange = (nextStart: number, nextEnd: number) => {
    setTrimStart(nextStart);
    setTrimEnd(nextEnd);
    engine.pause();
    if (memo && hasRecording(memo)) {
      const file = getPrimaryLayerFile(memo);
      void engine.loadMemo(memo.id, file.uri, memo.duration, nextStart, nextEnd);
    }
  };

  if (loading || !memo) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={VoiceMemosColors.accent} />
      </View>
    );
  }

  const duration = memo.duration;
  const effectiveDuration = trimEnd > trimStart ? trimEnd - trimStart : duration;
  const isRecording = engineState.isRecording;
  const currentTime = engineState.memoId === memo.id ? engineState.currentTime : trimStart;

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
      <Stack.Screen options={{ title: memo.title }} />
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
            peaks={waveformPeaks}
            trimEnd={isRecording ? waveformDuration : trimEnd}
            trimStart={isRecording ? 0 : trimStart}
            onSeek={(time) => {
              if (!isRecording) {
                engine.seek(time);
              }
            }}
            onWidthChange={setWaveformWidth}
          />
          {!isRecording ? (
            <TrimHandles
              duration={duration}
              trimEnd={trimEnd}
              trimStart={trimStart}
              width={waveformWidth}
              onTrimChange={handleTrimChange}
            />
          ) : null}
        </View>

        <View style={styles.timeDisplay}>
          <Text style={styles.largeTime}>
            {formatDuration(
              isRecording
                ? engineState.recordingDuration
                : Math.max(0, currentTime - trimStart)
            )}
          </Text>
          {!isRecording ? (
            <Text style={styles.remainingTime}>
              −{formatDuration(Math.max(0, effectiveDuration - (currentTime - trimStart)))}
            </Text>
          ) : null}
        </View>

        {isRecording ? (
          <View style={styles.recordingPanel}>
            <Text style={styles.recordingLabel}>
              {replaceMode ? 'Recording replacement…' : 'Recording…'}
            </Text>
            <Text style={styles.recordingTime}>{formatDuration(engineState.recordingDuration)}</Text>
            <Pressable onPress={() => void handleStopRecording()} style={styles.stopButton}>
              <View style={styles.stopSquare} />
            </Pressable>
          </View>
        ) : (
          <>
            <PlaybackControls
              currentTime={Math.max(0, currentTime - trimStart)}
              duration={effectiveDuration}
              isPlaying={engineState.isPlaying}
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
    paddingHorizontal: 8,
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
    position: 'relative',
    minHeight: 120,
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
  remainingTime: {
    fontSize: 16,
    color: VoiceMemosColors.secondaryText,
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
