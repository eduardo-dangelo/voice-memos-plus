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
import type { LayerEffects } from '@/src/audio/layerEffects';
import { isDefaultTrim, mergeLayerEffects } from '@/src/audio/layerEffects';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import { PlaybackControls } from '@/src/components/PlaybackControls';
import { TrackEditorShell } from '@/src/components/track-editor/TrackEditorShell';
import type { EditorTool } from '@/src/components/track-editor/types';
import { WaveformView, type TrackData } from '@/src/components/WaveformView';
import {
  addStackedLayer,
  commitLayerTrim,
  ensureWaveformPeaks,
  getMemo,
  replaceLayerSegment,
  saveRecording,
  updateLayerEffects,
  updateLayerStartTimes,
  updateTitle,
} from '@/src/storage/memoStore';
import {
  applyTimelineDeltaToLayers,
  getEarliestTrimInTimelineDelta,
  getLayerEffects,
  getLayerActiveDuration,
  getLayerActiveStartTime,
  getMemoTimelineDuration,
  hasRecording,
} from '@/src/storage/types';
import { slicePeaksForTrim } from '@/src/audio/waveform';
import type { Memo } from '@/src/storage/types';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
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
  const persistEffectsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEffectsPersist = useRef<{
    memoId: string;
    layerId: string;
    effects: LayerEffects;
    layerStartTimes?: Record<string, number>;
  } | null>(null);

  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [stackMode, setStackMode] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<EditorTool | null>(null);
  const [savingTrim, setSavingTrim] = useState(false);

  const activeLayer = useMemo(() => {
    if (!memo || !activeLayerId) {
      return null;
    }
    return memo.layers.find((layer) => layer.id === activeLayerId) ?? null;
  }, [activeLayerId, memo]);

  const activeLayerEffects = useMemo(() => {
    return activeLayer ? getLayerEffects(activeLayer) : null;
  }, [activeLayer]);

  const handleEffectsChange = useCallback(
    (partial: Parameters<typeof updateLayerEffects>[2]) => {
      if (!memo || !activeLayerId) {
        return;
      }

      const layer = memo.layers.find((entry) => entry.id === activeLayerId);
      if (!layer) {
        return;
      }

      const nextEffects = mergeLayerEffects(getLayerEffects(layer), partial, layer.duration);
      const trimInChanged = partial.trimIn !== undefined;
      const timelineDelta = trimInChanged
        ? getEarliestTrimInTimelineDelta(layer, memo.layers, nextEffects.trimIn)
        : 0;
      const shiftedLayers = applyTimelineDeltaToLayers(memo.layers, timelineDelta);
      const nextLayers = shiftedLayers.map((entry) =>
        entry.id === activeLayerId ? { ...entry, effects: nextEffects } : entry
      );
      const layerStartTimes =
        timelineDelta !== 0
          ? Object.fromEntries(nextLayers.map((entry) => [entry.id, entry.startTime]))
          : undefined;

      setMemo({
        ...memo,
        layers: nextLayers,
      });
      engine.updateLayerEffects(activeLayerId, partial);
      if (layerStartTimes) {
        engine.updateLayerStartTimes(layerStartTimes);
      }
      pendingEffectsPersist.current = {
        memoId: memo.id,
        layerId: activeLayerId,
        effects: nextEffects,
        ...(layerStartTimes ? { layerStartTimes } : {}),
      };

      if (persistEffectsTimeout.current) {
        clearTimeout(persistEffectsTimeout.current);
      }
      persistEffectsTimeout.current = setTimeout(() => {
        void updateLayerEffects(memo.id, activeLayerId, {
          trimIn: nextEffects.trimIn,
          trimOut: nextEffects.trimOut,
          volumeDb: nextEffects.volumeDb,
          reverb: nextEffects.reverb,
          delay: nextEffects.delay,
          eq: nextEffects.eq,
        });
        if (layerStartTimes) {
          void updateLayerStartTimes(memo.id, layerStartTimes);
        }
      }, 300);
    },
    [activeLayerId, engine, memo]
  );

  const flushEffectsPersist = useCallback(() => {
    if (persistEffectsTimeout.current) {
      clearTimeout(persistEffectsTimeout.current);
      persistEffectsTimeout.current = null;
    }
    const pending = pendingEffectsPersist.current;
    if (!pending) {
      return;
    }
    void updateLayerEffects(pending.memoId, pending.layerId, {
      trimIn: pending.effects.trimIn,
      trimOut: pending.effects.trimOut,
      volumeDb: pending.effects.volumeDb,
      reverb: pending.effects.reverb,
      delay: pending.effects.delay,
      eq: pending.effects.eq,
    });
    if (pending.layerStartTimes) {
      void updateLayerStartTimes(pending.memoId, pending.layerStartTimes);
    }
  }, []);

  const commitActiveLayerTrim = useCallback(async (): Promise<boolean> => {
      if (!memo || !activeLayerId || !activeLayer || !activeLayerEffects || savingTrim) {
        return false;
      }

      if (persistEffectsTimeout.current) {
        clearTimeout(persistEffectsTimeout.current);
        persistEffectsTimeout.current = null;
      }

      const trimIsDefault = isDefaultTrim(activeLayerEffects, activeLayer.duration);

      if (trimIsDefault) {
        flushEffectsPersist();
        return true;
      }

      setSavingTrim(true);
      engine.pause();

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      try {
        pendingEffectsPersist.current = null;
        const updated = await commitLayerTrim(memo.id, activeLayerId, {
          trimIn: activeLayerEffects.trimIn,
          trimOut: activeLayerEffects.trimOut,
          preservedEffects: {
            volumeDb: activeLayerEffects.volumeDb,
            reverb: activeLayerEffects.reverb,
            delay: activeLayerEffects.delay,
            eq: activeLayerEffects.eq,
          },
        });
        setMemo(updated);
        const seekTime = Math.min(engine.getPlaybackTime(), getMemoTimelineDuration(updated));
        await loadMemoIntoEngine(engine, updated, seekTime);
        return true;
      } catch (error) {
        const reverted = await getMemo(memo.id);
        if (reverted) {
          setMemo(reverted);
          pendingEffectsPersist.current = null;
          await loadMemoIntoEngine(engine, reverted);
        }
        Alert.alert(
          'Could not apply trim',
          error instanceof Error ? error.message : 'Unknown error'
        );
        return false;
      } finally {
        setSavingTrim(false);
      }
    },
    [
      activeLayer,
      activeLayerEffects,
      activeLayerId,
      engine,
      flushEffectsPersist,
      memo,
      savingTrim,
    ]
  );

  const commitTrimIfNeeded = useCallback(async (): Promise<boolean> => {
    if (
      activeEditor !== 'trim' ||
      !activeLayer ||
      !activeLayerEffects ||
      isDefaultTrim(activeLayerEffects, activeLayer.duration)
    ) {
      flushEffectsPersist();
      return true;
    }
    return commitActiveLayerTrim();
  }, [
    activeEditor,
    activeLayer,
    activeLayerEffects,
    commitActiveLayerTrim,
    flushEffectsPersist,
  ]);

  const handleEditorToolChange = useCallback(
    (tool: EditorTool | null) => {
      if (savingTrim) {
        return;
      }

      if (activeEditor === 'trim' && tool !== 'trim') {
        void (async () => {
          const ok = await commitTrimIfNeeded();
          if (!ok) {
            return;
          }
          setActiveEditor(tool);
        })();
        return;
      }

      setActiveEditor(tool);
    },
    [activeEditor, commitTrimIfNeeded, savingTrim]
  );

  const handleTrimChange = useCallback(
    (trimIn: number, trimOut: number) => {
      handleEffectsChange({ trimIn, trimOut });
    },
    [handleEffectsChange]
  );

  const handleTrackPress = useCallback(
    (trackId: string) => {
      if (trackId === activeLayerId || savingTrim) {
        return;
      }

      void (async () => {
        const ok = await commitTrimIfNeeded();
        if (!ok) {
          return;
        }

        setActiveLayerId(trackId);
      })();
    },
    [activeLayerId, commitTrimIfNeeded, savingTrim]
  );

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
      if (persistEffectsTimeout.current) {
        clearTimeout(persistEffectsTimeout.current);
      }
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
    const ok = await commitTrimIfNeeded();
    if (!ok) {
      return;
    }
    if (title.trim() && title !== memo.title) {
      await updateTitle(memo.id, title);
    }
    router.back();
  }, [commitTrimIfNeeded, engine, memo, title]);

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

  const handlePlayPause = useCallback(async () => {
    try {
      await engine.togglePlayback();
    } catch (error) {
      Alert.alert(
        'Playback failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }, [engine]);

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

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    void (async () => {
      await commitTrimIfNeeded();
      setActiveEditor(null);
    })();
  }, [commitTrimIfNeeded, isRecording]);

  const showTrackEditor =
    !isRecording && Boolean(activeLayer && activeLayer.duration > 0);

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
      .map((layer) => {
        const isTrimEditing =
          activeEditor === 'trim' && !savingTrim && layer.id === activeLayerId;

        if (isTrimEditing) {
          return {
            id: layer.id,
            peaks: layer.waveformPeaks,
            startTime: layer.startTime,
            duration: layer.duration,
            isActive: true,
          };
        }

        const effects = getLayerEffects(layer);
        const activeDuration = getLayerActiveDuration(layer);

        return {
          id: layer.id,
          peaks: slicePeaksForTrim(
            layer.waveformPeaks,
            layer.duration,
            effects.trimIn,
            effects.trimOut
          ),
          startTime: getLayerActiveStartTime(layer),
          duration: Math.max(activeDuration, 0.01),
          isActive: layer.id === activeLayerId,
        };
      });

    if (isRecording) {
      const recordingTrack: TrackData = {
        id: '__recording__',
        peaks:
          engineState.recordingPeaks.length > 0 ? engineState.recordingPeaks : undefined,
        startTime: replaceMode || stackMode ? recordingStartTime.current : 0,
        duration: Math.max(engineState.recordingDuration, 0.01),
        isActive: true,
      };

      if (replaceMode || stackMode) {
        return [recordingTrack, ...playableTracks.map((track) => ({ ...track, isActive: false }))];
      }

      return [recordingTrack];
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
    activeEditor,
    activeLayerId,
    duration,
    engineState.recordingDuration,
    engineState.recordingPeaks,
    isRecording,
    memo,
    replaceMode,
    savingTrim,
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
            getRecordingTime={() =>
              recordingStartTime.current + engine.getRecordingDuration()
            }
            isPlaying={engineState.isPlaying}
            isRecording={isRecording}
            tracks={waveformTracks}
            trimOverlay={
              activeEditor === 'trim' && !savingTrim && activeLayer && activeLayerEffects
                ? {
                    layerId: activeLayer.id,
                    trimIn: activeLayerEffects.trimIn,
                    trimOut: activeLayerEffects.trimOut,
                    onChange: handleTrimChange,
                  }
                : undefined
            }
            volumeVisualDb={
              activeEditor === 'volume' && activeLayerEffects
                ? activeLayerEffects.volumeDb
                : undefined
            }
            onSeek={(time) => {
              if (!isRecording) {
                engine.seek(time);
              }
            }}
            onTrackPress={handleTrackPress}
          />
        </View>

        {activeLayerEffects ? (
          <TrackEditorShell
            activeTool={activeEditor}
            effects={activeLayerEffects}
            layerDuration={activeLayer?.duration ?? 0}
            visible={showTrackEditor}
            onEffectsChange={handleEffectsChange}
            onToolChange={handleEditorToolChange}
          />
        ) : null}

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
              onPlayPause={() => void handlePlayPause()}
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
