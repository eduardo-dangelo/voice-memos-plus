import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { DEFAULT_TRACK_COLOR, pickRandomTrackColor } from '@/constants/VoiceMemosColors';
import { showMemoActionSheet } from '@/src/actions/showMemoActionSheet';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import {
  isHeadphonesConnected,
  needsMonitorMix,
  requiresHeadphones,
  subscribeHeadphoneDisconnect,
} from '@/src/audio/headphoneDetection';
import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';
import { mergeLayerEffects } from '@/src/audio/layerEffects';
import {
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
} from '@/src/audio/performanceWarning';
import { slicePeaksForTrim } from '@/src/audio/waveform';
import { PlaybackControls } from '@/src/components/PlaybackControls';
import { TrackEditorShell } from '@/src/components/track-editor/TrackEditorShell';
import type { EditorTool } from '@/src/components/track-editor/types';
import { resolveTrackColor, TrackColorPicker } from '@/src/components/TrackColorPicker';
import { WaveformView, type TrackData } from '@/src/components/WaveformView';
import {
  addStackedLayer,
  deactivateMemoLoop,
  deleteLayer,
  deleteMemo,
  duplicateMemo,
  ensureWaveformPeaks,
  getMemo,
  getShareableFile,
  permanentlyDeleteMemo,
  replaceLayerSegment,
  saveRecording,
  updateLayerColor,
  updateLayerEffects,
  updateLayerLabel,
  updateLayerStartTimes,
  updateLoopRegion,
  updateTitle,
} from '@/src/storage/memoStore';
import { getMemoPlaybackTimeline, isMemoInTrash } from '@/src/storage/paths';
import type { Layer, Memo } from '@/src/storage/types';
import {
  applyTimelineDeltaToLayers,
  clampLayerStartTime,
  getEarliestTrimInTimelineDelta,
  getLayerActiveDuration,
  getLayerActiveEndTime,
  getLayerActiveStartTime,
  getLayerEffects,
  getLayerFileOffsetAtTimeline,
  getMemoTimelineDuration,
  getPlayableLayers,
  hasRecording,
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDurationWithTenths } from '@/src/utils/format';

async function loadMemoIntoEngine(
  engine: ReturnType<typeof useAudioEngine>,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  const { layers, duration, trimStart, trimEnd } = getMemoPlaybackTimeline(memo);
  await engine.loadMemo(
    memo.id,
    layers,
    trimStart,
    trimEnd,
    duration,
    memo.loopStart ?? 0,
    memo.loopEnd ?? 0,
    memo.loopEnabled ?? false
  );
  if (seekTime !== undefined) {
    engine.seek(seekTime);
  }
}

function deactivateLoopForMemo(
  engine: ReturnType<typeof useAudioEngine>,
  memo: Memo,
  setMemo: Dispatch<SetStateAction<Memo | null>>
): void {
  if (!memo.loopEnabled) {
    return;
  }
  engine.setLoopEnabled(false);
  setMemo({ ...memo, loopEnabled: false });
  void deactivateMemoLoop(memo.id);
}

type EditDraftSnapshot = {
  tool: 'trim' | 'move';
  layers: Layer[];
  duration: number;
  trimEnd: number;
  generation: number;
};

function cloneLayers(layers: Layer[]): Layer[] {
  return JSON.parse(JSON.stringify(layers)) as Layer[];
}

export default function MemoEditorScreen() {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useMemoEditorStyles(colors, colorScheme);
  const { id, record, backTitle } = useLocalSearchParams<{
    id: string;
    record?: string;
    backTitle?: string;
  }>();
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const autoRecordStarted = useRef(false);
  const recordingStartTime = useRef(0);
  const persistEffectsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistStartTimeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistLoopTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEffectsPersist = useRef<{
    memoId: string;
    layerId: string;
    effects: LayerEffects;
    layerStartTimes?: Record<string, number>;
  } | null>(null);
  const pendingStartTimePersist = useRef<{
    memoId: string;
    layerId: string;
    startTime: number;
  } | null>(null);

  const [memo, setMemo] = useState<Memo | null>(null);
  const memoRef = useRef<Memo | null>(null);
  memoRef.current = memo;
  const [loading, setLoading] = useState(true);
  const [replaceMode, setReplaceMode] = useState(false);
  const [stackMode, setStackMode] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<EditorTool | null>(null);
  const [savingTrim, setSavingTrim] = useState(false);
  const [colorPickerLayerId, setColorPickerLayerId] = useState<string | null>(null);
  const stackModeRef = useRef(false);
  const replaceModeRef = useRef(false);
  const activeLayerIdRef = useRef<string | null>(null);
  const isSavingRecordingOnExit = useRef(false);
  const saveRecordingInFlight = useRef<Promise<boolean> | null>(null);
  const pendingRecordingColor = useRef<string | null>(null);
  const monitorMixRef = useRef(false);
  const editDraftRef = useRef<EditDraftSnapshot | null>(null);
  const draftGenerationRef = useRef(0);
  stackModeRef.current = stackMode;
  replaceModeRef.current = replaceMode;
  activeLayerIdRef.current = activeLayerId;

  const activeLayer = useMemo(() => {
    if (!memo || !activeLayerId) {
      return null;
    }
    return memo.layers.find((layer) => layer.id === activeLayerId) ?? null;
  }, [activeLayerId, memo]);

  const activeLayerEffects = useMemo(() => {
    return activeLayer ? getLayerEffects(activeLayer) : null;
  }, [activeLayer]);

  const isDraftGenerationCurrent = useCallback((generation: number | undefined) => {
    return (
      generation !== undefined &&
      editDraftRef.current !== null &&
      editDraftRef.current.generation === generation
    );
  }, []);

  const applyLayerEffectsChange = useCallback(
    (layerId: string, partial: LayerEffectsChange) => {
      const draftGeneration = editDraftRef.current?.generation;
      const isDraftTrimUpdate =
        editDraftRef.current?.tool === 'trim' &&
        (partial.trimIn !== undefined || partial.trimOut !== undefined);

      let nextEffects: ReturnType<typeof mergeLayerEffects> | null = null;
      let layerStartTimes: Record<string, number> | undefined;
      let memoId: string | null = null;
      let applied = false;

      setMemo((prev) => {
        if (!prev) {
          return prev;
        }

        if (isDraftTrimUpdate && !isDraftGenerationCurrent(draftGeneration)) {
          return prev;
        }

        const layer = prev.layers.find((entry) => entry.id === layerId);
        if (!layer) {
          return prev;
        }

        const mergedEffects = mergeLayerEffects(getLayerEffects(layer), partial, layer.duration);
        const trimInChanged = partial.trimIn !== undefined;
        const timelineDelta = trimInChanged
          ? getEarliestTrimInTimelineDelta(layer, prev.layers, mergedEffects.trimIn)
          : 0;
        const shiftedLayers = applyTimelineDeltaToLayers(prev.layers, timelineDelta);
        const nextLayers = shiftedLayers.map((entry) =>
          entry.id === layerId ? { ...entry, effects: mergedEffects } : entry
        );

        applied = true;
        nextEffects = mergedEffects;
        memoId = prev.id;
        layerStartTimes =
          timelineDelta !== 0
            ? Object.fromEntries(nextLayers.map((entry) => [entry.id, entry.startTime]))
            : undefined;

        return {
          ...prev,
          layers: nextLayers,
        };
      });

      if (!applied || !nextEffects || !memoId) {
        return;
      }

      if (isDraftTrimUpdate && !isDraftGenerationCurrent(draftGeneration)) {
        return;
      }

      if (partial.muted === true && activeLayerIdRef.current === layerId) {
        setActiveLayerId(null);
        setActiveEditor(null);
      }

      engine.updateLayerEffects(layerId, partial);
      if (layerStartTimes) {
        engine.updateLayerStartTimes(layerStartTimes);
      }

      if (isDraftTrimUpdate) {
        return;
      }

      pendingEffectsPersist.current = {
        memoId,
        layerId,
        effects: nextEffects,
        ...(layerStartTimes ? { layerStartTimes } : {}),
      };

      if (persistEffectsTimeout.current) {
        clearTimeout(persistEffectsTimeout.current);
      }
      persistEffectsTimeout.current = setTimeout(() => {
        void updateLayerEffects(memoId!, layerId, {
          trimIn: nextEffects!.trimIn,
          trimOut: nextEffects!.trimOut,
          volumeDb: nextEffects!.volumeDb,
          muted: nextEffects!.muted,
          reverb: nextEffects!.reverb,
          delay: nextEffects!.delay,
          eq: nextEffects!.eq,
        });
        if (layerStartTimes) {
          void updateLayerStartTimes(memoId!, layerStartTimes);
        }
      }, 300);
    },
    [engine, isDraftGenerationCurrent]
  );

  const handleEffectsChange = useCallback(
    (partial: LayerEffectsChange) => {
      if (!activeLayerId) {
        return;
      }
      applyLayerEffectsChange(activeLayerId, partial);
    },
    [activeLayerId, applyLayerEffectsChange]
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
      muted: pending.effects.muted,
      reverb: pending.effects.reverb,
      delay: pending.effects.delay,
      eq: pending.effects.eq,
    });
    if (pending.layerStartTimes) {
      void updateLayerStartTimes(pending.memoId, pending.layerStartTimes);
    }
  }, []);

  const flushStartTimePersist = useCallback(() => {
    if (persistStartTimeTimeout.current) {
      clearTimeout(persistStartTimeTimeout.current);
      persistStartTimeTimeout.current = null;
    }
    const pending = pendingStartTimePersist.current;
    if (!pending) {
      return;
    }
    pendingStartTimePersist.current = null;
    void updateLayerStartTimes(pending.memoId, { [pending.layerId]: pending.startTime });
  }, []);

  const clearDraftPersistTimers = useCallback(() => {
    if (persistEffectsTimeout.current) {
      clearTimeout(persistEffectsTimeout.current);
      persistEffectsTimeout.current = null;
    }
    pendingEffectsPersist.current = null;
    if (persistStartTimeTimeout.current) {
      clearTimeout(persistStartTimeTimeout.current);
      persistStartTimeTimeout.current = null;
    }
    pendingStartTimePersist.current = null;
  }, []);

  const beginEditDraft = useCallback(
    (tool: 'trim' | 'move') => {
      const current = memoRef.current;
      if (!current) {
        return;
      }
      draftGenerationRef.current += 1;
      editDraftRef.current = {
        tool,
        layers: cloneLayers(current.layers),
        duration: current.duration,
        trimEnd: current.trimEnd,
        generation: draftGenerationRef.current,
      };
      setActiveEditor(tool);
    },
    []
  );

  const cancelEditDraft = useCallback(async (): Promise<void> => {
    const snapshot = editDraftRef.current;
    if (!snapshot) {
      return;
    }

    draftGenerationRef.current += 1;
    clearDraftPersistTimers();
    editDraftRef.current = null;
    setActiveEditor(null);

    const current = memoRef.current;
    if (!current) {
      return;
    }

    const restored: Memo = {
      ...current,
      layers: cloneLayers(snapshot.layers),
      duration: snapshot.duration,
      trimEnd: snapshot.trimEnd,
    };
    memoRef.current = restored;
    setMemo(restored);
    const seekTime = Math.min(
      engine.getPlaybackTime(),
      getMemoTimelineDuration(restored)
    );
    await loadMemoIntoEngine(engine, restored, seekTime);
  }, [clearDraftPersistTimers, engine]);

  const confirmEditDraft = useCallback(async (): Promise<void> => {
    const snapshot = editDraftRef.current;
    const current = memoRef.current;
    if (!snapshot || !current) {
      draftGenerationRef.current += 1;
      editDraftRef.current = null;
      setActiveEditor(null);
      return;
    }

    draftGenerationRef.current += 1;
    clearDraftPersistTimers();
    editDraftRef.current = null;
    setSavingTrim(true);

    try {
      if (snapshot.tool === 'trim' && activeLayerId) {
        const layer = current.layers.find((entry) => entry.id === activeLayerId);
        if (layer) {
          const effects = getLayerEffects(layer);
          await updateLayerEffects(current.id, activeLayerId, {
            trimIn: effects.trimIn,
            trimOut: effects.trimOut,
            volumeDb: effects.volumeDb,
            muted: effects.muted,
            reverb: effects.reverb,
            delay: effects.delay,
            eq: effects.eq,
          });
        }
      }

      const startTimes = Object.fromEntries(
        current.layers.map((layer) => [layer.id, layer.startTime])
      );
      const updated = await updateLayerStartTimes(current.id, startTimes);
      memoRef.current = updated;
      setMemo(updated);
      setActiveEditor(null);
    } catch (error) {
      Alert.alert(
        snapshot.tool === 'trim' ? 'Could not apply trim' : 'Could not apply move',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setSavingTrim(false);
    }
  }, [activeLayerId, clearDraftPersistTimers]);

  const handleEditorToolChange = useCallback(
    (tool: EditorTool | null) => {
      if (savingTrim) {
        return;
      }

      const draft = editDraftRef.current;
      if (draft && tool !== draft.tool) {
        void cancelEditDraft().then(() => {
          if (tool === 'trim' || tool === 'move') {
            beginEditDraft(tool);
          } else {
            setActiveEditor(tool);
          }
        });
        return;
      }

      if (tool === 'trim' || tool === 'move') {
        beginEditDraft(tool);
        return;
      }

      setActiveEditor(tool);
    },
    [beginEditDraft, cancelEditDraft, savingTrim]
  );

  const handleConfirmDraft = useCallback(() => {
    if (savingTrim) {
      return;
    }
    void confirmEditDraft();
  }, [confirmEditDraft, savingTrim]);

  const handleCancelDraft = useCallback(() => {
    if (savingTrim) {
      return;
    }
    void cancelEditDraft();
  }, [cancelEditDraft, savingTrim]);

  const handleTrimChange = useCallback(
    (trimIn: number, trimOut: number) => {
      handleEffectsChange({ trimIn, trimOut });
    },
    [handleEffectsChange]
  );

  const handleLayerStartTimeChange = useCallback(
    (startTime: number) => {
      if (!activeLayerId) {
        return;
      }

      const draftGeneration = editDraftRef.current?.generation;
      const isDraftMove = editDraftRef.current?.tool === 'move';
      let nextStartTime: number | null = null;
      let timeline: number | null = null;
      let memoId: string | null = null;
      let applied = false;

      setMemo((prev) => {
        if (!prev) {
          return prev;
        }

        if (isDraftMove && !isDraftGenerationCurrent(draftGeneration)) {
          return prev;
        }

        const layer = prev.layers.find((entry) => entry.id === activeLayerId);
        if (!layer) {
          return prev;
        }

        const trimIn = getLayerEffects(layer).trimIn;
        const clampedStartTime = clampLayerStartTime(startTime, trimIn);
        const nextLayers = prev.layers.map((entry) =>
          entry.id === activeLayerId ? { ...entry, startTime: clampedStartTime } : entry
        );
        const previousDuration = prev.duration;
        const nextTimeline = getMemoTimelineDuration({ ...prev, layers: nextLayers });
        let trimEnd = prev.trimEnd;
        if (nextTimeline <= 0) {
          trimEnd = 0;
        } else if (trimEnd === 0) {
          trimEnd = nextTimeline;
        } else if (trimEnd > nextTimeline) {
          trimEnd = nextTimeline;
        } else {
          const trimWasAtPreviousEnd = prev.trimEnd >= previousDuration - 0.05;
          if (nextTimeline > previousDuration && trimWasAtPreviousEnd) {
            trimEnd = nextTimeline;
          }
        }

        applied = true;
        nextStartTime = clampedStartTime;
        timeline = nextTimeline;
        memoId = prev.id;

        return {
          ...prev,
          layers: nextLayers,
          duration: nextTimeline,
          trimEnd,
        };
      });

      if (!applied || nextStartTime === null || timeline === null || !memoId) {
        return;
      }

      if (isDraftMove && !isDraftGenerationCurrent(draftGeneration)) {
        return;
      }

      engine.updateLayerStartTime(activeLayerId, nextStartTime);
      engine.updateTimelineDuration(timeline);

      if (isDraftMove) {
        return;
      }

      pendingStartTimePersist.current = {
        memoId,
        layerId: activeLayerId,
        startTime: nextStartTime,
      };

      if (persistStartTimeTimeout.current) {
        clearTimeout(persistStartTimeTimeout.current);
      }
      persistStartTimeTimeout.current = setTimeout(() => {
        void updateLayerStartTimes(memoId!, { [activeLayerId]: nextStartTime! });
      }, 300);
    },
    [activeLayerId, engine, isDraftGenerationCurrent]
  );

  const handleLoopChange = useCallback(
    (loopStart: number, loopEnd: number, loopEnabled: boolean) => {
      if (!memo) {
        return;
      }
      setMemo({ ...memo, loopStart, loopEnd, loopEnabled });
      engine.setLoopRegion(loopStart, loopEnd, loopEnabled);

      if (persistLoopTimeout.current) {
        clearTimeout(persistLoopTimeout.current);
      }
      persistLoopTimeout.current = setTimeout(() => {
        void updateLoopRegion(memo.id, loopStart, loopEnd, loopEnabled);
      }, 300);
    },
    [engine, memo]
  );

  const handleTrackPress = useCallback(
    (trackId: string) => {
      if (trackId === activeLayerId || savingTrim) {
        return;
      }

      const layer = memo?.layers.find((entry) => entry.id === trackId);
      if (layer && getLayerEffects(layer).muted) {
        return;
      }

      void (async () => {
        await cancelEditDraft();
        flushEffectsPersist();
        flushStartTimePersist();
        setActiveLayerId(trackId);
        setActiveEditor(null);
      })();
    },
    [
      activeLayerId,
      cancelEditDraft,
      flushEffectsPersist,
      flushStartTimePersist,
      memo,
      savingTrim,
    ]
  );

  const handleTrackDeselect = useCallback(() => {
    if (!activeLayerId || savingTrim) {
      return;
    }

    void (async () => {
      await cancelEditDraft();
      flushEffectsPersist();
      flushStartTimePersist();
      setActiveLayerId(null);
      setActiveEditor(null);
    })();
  }, [
    activeLayerId,
    cancelEditDraft,
    flushEffectsPersist,
    flushStartTimePersist,
    savingTrim,
  ]);

  const handleDeleteTrack = useCallback(
    async (layerId: string) => {
      if (!memo) {
        return;
      }

      try {
        await cancelEditDraft();
        flushEffectsPersist();
        flushStartTimePersist();
        const current = memoRef.current;
        if (!current) {
          return;
        }
        const seekTime = Math.min(engine.getPlaybackTime(), current.duration);
        const updated = await deleteLayer(current.id, layerId);
        const nextActiveId =
          getPlayableLayers(updated)[0]?.id ?? updated.layers[0]?.id ?? null;
        memoRef.current = updated;
        setMemo(updated);
        setActiveLayerId(nextActiveId);
        setActiveEditor(null);
        await loadMemoIntoEngine(engine, updated, seekTime);
      } catch (error) {
        Alert.alert(
          'Delete failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    },
    [cancelEditDraft, engine, flushEffectsPersist, flushStartTimePersist, memo]
  );

  const showTrackOptions = useCallback(
    (layerId: string) => {
      if (!memo || layerId === '__recording__' || layerId === 'empty') {
        return;
      }

      const layer = memo.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.duration <= 0) {
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const effects = getLayerEffects(layer);
      const muteLabel = effects.muted ? 'Unmute' : 'Mute';
      const canDelete = getPlayableLayers(memo).length > 1;
      const options = canDelete
        ? ['Rename Track', 'Change Color', muteLabel, 'Delete Track', 'Cancel']
        : ['Rename Track', 'Change Color', muteLabel, 'Cancel'];
      const destructiveButtonIndex = canDelete ? 3 : undefined;
      const cancelButtonIndex = canDelete ? 4 : 3;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        (index) => {
          if (index === 0) {
            if (layerId !== activeLayerId && !effects.muted) {
              setActiveLayerId(layerId);
            }
            Alert.prompt('Rename Track', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Save',
                onPress: (value?: string) => {
                  if (value?.trim()) {
                    void updateLayerLabel(memo.id, layerId, value.trim()).then(setMemo);
                  }
                },
              },
            ], 'plain-text', layer.label);
            return;
          }
          if (index === 1) {
            if (layerId !== activeLayerId && !effects.muted) {
              setActiveLayerId(layerId);
            }
            setColorPickerLayerId(layerId);
            return;
          }
          if (index === 2) {
            applyLayerEffectsChange(layerId, { muted: !effects.muted });
            return;
          }
          if (canDelete && index === 3) {
            Alert.alert('Delete Track', 'Delete this track? This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  void handleDeleteTrack(layerId);
                },
              },
            ]);
          }
        }
      );
    },
    [activeLayerId, applyLayerEffectsChange, handleDeleteTrack, memo]
  );

  const handleTrackColorSelect = useCallback(
    (color: string) => {
      if (!memo || !colorPickerLayerId) {
        return;
      }
      void updateLayerColor(memo.id, colorPickerLayerId, color).then((updated) => {
        setMemo(updated);
        setColorPickerLayerId(null);
      });
    },
    [colorPickerLayerId, memo]
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
      const defaultLayer = loaded.layers.find(
        (layer) => layer.duration > 0 && !getLayerEffects(layer).muted
      );
      setActiveLayerId(defaultLayer?.id ?? null);
      if (hasRecording(loaded)) {
        await loadMemoIntoEngine(engine, loaded);
      } else {
        engine.unload();
      }
    }
    setLoading(false);
  }, [engine, id]);

  useEffect(() => {
    if (!memo || !hasRecording(memo)) {
      return;
    }
    maybeShowPerformanceWarning(memo);
  }, [memo]);

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

  const stopAndSaveActiveRecording = useCallback(
    async (options?: { reloadEngine?: boolean }): Promise<boolean> => {
      if (saveRecordingInFlight.current) {
        return saveRecordingInFlight.current;
      }

      if (!engine.getState().isRecording) {
        return true;
      }

      const currentMemo = memoRef.current;
      if (!currentMemo) {
        return false;
      }

      const reloadEngine = options?.reloadEngine !== false;

      const savePromise = (async (): Promise<boolean> => {
        isSavingRecordingOnExit.current = true;
        try {
          const { path, duration, peaks } = await engine.stopRecording();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          const wasStackMode = stackModeRef.current;
          const wasReplaceMode = replaceModeRef.current;
          const capturedStartTime = recordingStartTime.current;
          const layerId = activeLayerIdRef.current;

          let updated: Memo;
          if (wasStackMode) {
            updated = await addStackedLayer(
              currentMemo.id,
              capturedStartTime,
              path,
              peaks,
              pendingRecordingColor.current ?? undefined
            );
            setActiveLayerId(updated.layers[updated.layers.length - 1]?.id ?? layerId);
          } else if (wasReplaceMode) {
            if (!layerId) {
              throw new Error('No track selected');
            }
            const replaceLayer = currentMemo.layers.find((layer) => layer.id === layerId);
            if (!replaceLayer || replaceLayer.duration <= 0) {
              throw new Error('No active layer');
            }
            const effects = getLayerEffects(replaceLayer);
            const fileTrimStart = getLayerFileOffsetAtTimeline(
              replaceLayer,
              capturedStartTime
            );
            const fileTrimEnd = Math.min(
              fileTrimStart + duration,
              effects.trimOut,
              replaceLayer.duration
            );
            updated = await replaceLayerSegment(
              currentMemo.id,
              replaceLayer.id,
              fileTrimStart,
              fileTrimEnd,
              path,
              peaks
            );
          } else {
            updated = await saveRecording(currentMemo.id, path, duration, peaks);
            setActiveLayerId(updated.layers[0]?.id ?? null);
          }

          setMemo(updated);
          setReplaceMode(false);
          setStackMode(false);
          monitorMixRef.current = false;
          pendingRecordingColor.current = null;
          if (reloadEngine) {
            await loadMemoIntoEngine(
              engine,
              updated,
              wasStackMode || wasReplaceMode ? capturedStartTime : 0
            );
          }
          return true;
        } catch (error) {
          Alert.alert(
            'Could not save recording',
            error instanceof Error ? error.message : 'Unknown error'
          );
          return false;
        } finally {
          isSavingRecordingOnExit.current = false;
        }
      })();

      saveRecordingInFlight.current = savePromise;
      try {
        return await savePromise;
      } finally {
        if (saveRecordingInFlight.current === savePromise) {
          saveRecordingInFlight.current = null;
        }
      }
    },
    [engine]
  );

  const cancelActiveRecording = useCallback(async () => {
    if (!engine.getState().isRecording) {
      return;
    }

    await engine.cancelRecording();
    monitorMixRef.current = false;
    setReplaceMode(false);
    setStackMode(false);
    pendingRecordingColor.current = null;
  }, [engine]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isSavingRecordingOnExit.current) {
        e.preventDefault();
        return;
      }

      if (!engine.getState().isRecording) {
        return;
      }

      e.preventDefault();
      void stopAndSaveActiveRecording({ reloadEngine: false }).then((ok) => {
        if (ok) {
          navigation.dispatch(e.data.action);
        }
      });
    });

    return unsubscribe;
  }, [engine, navigation, stopAndSaveActiveRecording]);

  useEffect(() => {
    void loadMemo();
    return () => {
      resetPerformanceWarningState();
      engine.pause();
      if (persistEffectsTimeout.current) {
        clearTimeout(persistEffectsTimeout.current);
      }
      if (persistStartTimeTimeout.current) {
        clearTimeout(persistStartTimeTimeout.current);
      }
      if (persistLoopTimeout.current) {
        clearTimeout(persistLoopTimeout.current);
        persistLoopTimeout.current = null;
      }
      const current = memoRef.current;
      if (current) {
        deactivateLoopForMemo(engine, current, setMemo);
      }
    };
  }, [engine, loadMemo]);

  const handleDone = useCallback(async () => {
    if (!memo) {
      return;
    }
    const recordingSaved = await stopAndSaveActiveRecording({ reloadEngine: false });
    if (!recordingSaved) {
      return;
    }
    engine.pause();
    await cancelEditDraft();
    flushEffectsPersist();
    flushStartTimePersist();
    if (persistLoopTimeout.current) {
      clearTimeout(persistLoopTimeout.current);
      persistLoopTimeout.current = null;
    }
    const current = memoRef.current;
    if (current) {
      deactivateLoopForMemo(engine, current, setMemo);
    }
    router.back();
  }, [
    cancelEditDraft,
    engine,
    flushEffectsPersist,
    flushStartTimePersist,
    memo,
    stopAndSaveActiveRecording,
  ]);

  const flushEditorState = useCallback(async (): Promise<boolean> => {
    if (!memo) {
      return false;
    }
    const recordingSaved = await stopAndSaveActiveRecording({ reloadEngine: false });
    if (!recordingSaved) {
      return false;
    }
    engine.pause();
    await cancelEditDraft();
    flushEffectsPersist();
    flushStartTimePersist();
    if (persistLoopTimeout.current) {
      clearTimeout(persistLoopTimeout.current);
      persistLoopTimeout.current = null;
    }
    const current = memoRef.current;
    if (current) {
      deactivateLoopForMemo(engine, current, setMemo);
    }
    return true;
  }, [
    cancelEditDraft,
    engine,
    flushEffectsPersist,
    flushStartTimePersist,
    memo,
    stopAndSaveActiveRecording,
  ]);

  const handleShare = useCallback(async () => {
    if (!memo) {
      return;
    }
    const file = await getShareableFile(memo);
    if (!file.exists) {
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri);
    }
  }, [memo]);

  const handleRename = useCallback(() => {
    if (!memo) {
      return;
    }
    Alert.prompt('Rename Recording', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value?: string) => {
          if (value?.trim()) {
            void updateTitle(memo.id, value.trim()).then(setMemo);
          }
        },
      },
    ], 'plain-text', memo.title);
  }, [memo]);

  const handleDuplicate = useCallback(async () => {
    if (!memo) {
      return;
    }
    const ok = await flushEditorState();
    if (!ok) {
      return;
    }
    const duplicated = await duplicateMemo(memo.id);
    engine.unload();
    router.replace({ pathname: '/memo/[id]', params: { id: duplicated.id } });
  }, [engine, flushEditorState, memo]);

  const confirmDelete = useCallback(() => {
    if (!memo) {
      return;
    }
    Alert.alert(
      'Delete Recording',
      isMemoInTrash(memo.id)
        ? 'This recording will be permanently deleted.'
        : 'This recording will be deleted.',
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await flushEditorState();
            if (!ok) {
              return;
            }
            engine.unload();
            if (isMemoInTrash(memo.id)) {
              await permanentlyDeleteMemo(memo.id);
            } else {
              await deleteMemo(memo.id);
            }
            router.back();
          })();
        },
      },
    ]
    );
  }, [engine, flushEditorState, memo]);

  const showMemoMenu = useCallback(() => {
    showMemoActionSheet({
      includeEditRecording: false,
      onShare: () => void handleShare(),
      onRename: handleRename,
      onDuplicate: () => void handleDuplicate(),
      onDelete: confirmDelete,
    });
  }, [confirmDelete, handleDuplicate, handleRename, handleShare]);

  const renderHeaderBar = useCallback(
    () => (
      <View style={styles.headerBar}>
        <Pressable
          accessibilityLabel="More options"
          hitSlop={8}
          onPress={showMemoMenu}
          style={styles.moreButton}>
          <SymbolView name={{ ios: 'ellipsis' }} size={18} tintColor={colors.secondaryText} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {memo?.title ?? ''}
        </Text>
        <Pressable
          accessibilityLabel="Done"
          accessibilityState={{ disabled: engineState.isRecording }}
          disabled={engineState.isRecording}
          onPress={() => void handleDone()}
          style={[styles.doneButton, engineState.isRecording && styles.doneButtonDisabled]}>
          <SymbolView name={{ ios: 'checkmark' }} size={22} tintColor="#FFFFFF" />
        </Pressable>
      </View>
    ),
    [
      colors.secondaryText,
      engineState.isRecording,
      handleDone,
      memo?.title,
      showMemoMenu,
      styles.doneButton,
      styles.doneButtonDisabled,
      styles.headerBar,
      styles.headerTitle,
      styles.moreButton,
    ],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '',
      headerBackTitle: backTitle ?? 'Back',
      headerStyle: { backgroundColor: colors.sheetBackground },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.sheetBackground },
      headerTitle: renderHeaderBar,
      headerTitleAlign: 'center',
      headerTitleContainerStyle: {
        left: 0,
        right: 0,
        maxWidth: '100%',
        paddingHorizontal: 0,
      },
    });
  }, [backTitle, colors, navigation, renderHeaderBar]);

  const handleStopRecording = () => {
    void stopAndSaveActiveRecording();
  };

  const beginRecording = async (mode: 'replace' | 'stack') => {
    if (!memo || !hasRecording(memo)) {
      return;
    }

    if (mode === 'replace') {
      if (!activeLayerId) {
        Alert.alert('Select a track', 'Tap a track to select it before replacing.');
        return;
      }
      const replaceLayer = memo.layers.find((layer) => layer.id === activeLayerId);
      if (!replaceLayer || replaceLayer.duration <= 0) {
        Alert.alert('Select a track', 'Choose a recorded track to replace.');
        return;
      }
    }

    if (requiresHeadphones(memo, mode) && !(await isHeadphonesConnected())) {
      Alert.alert(
        'Connect headphones',
        'Plug in earbuds or headphones to record over existing tracks. Audio plays through your headphones; recording uses your iPhone microphone.'
      );
      return;
    }

    const useMonitorMix = needsMonitorMix(memo, mode);
    monitorMixRef.current = useMonitorMix;

    engine.pause();
    let startTime = engine.getPlaybackTime();
    if (mode === 'replace' && activeLayerId) {
      const replaceLayer = memo.layers.find((layer) => layer.id === activeLayerId);
      if (replaceLayer) {
        const activeStart = getLayerActiveStartTime(replaceLayer);
        const activeEnd = getLayerActiveEndTime(replaceLayer);
        startTime = Math.max(activeStart, Math.min(startTime, activeEnd));
      }
    }

    recordingStartTime.current = startTime;
    setReplaceMode(mode === 'replace');
    setStackMode(mode === 'stack');
    if (mode === 'stack') {
      const usedColors = memo.layers.map(
        (layer) => layer.color ?? DEFAULT_TRACK_COLOR
      );
      pendingRecordingColor.current = pickRandomTrackColor(usedColors);
    } else {
      pendingRecordingColor.current = null;
    }

    engine.seek(startTime);

    try {
      await engine.startRecording({
        monitorMix: useMonitorMix,
        monitorStartTime: useMonitorMix ? startTime : undefined,
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      monitorMixRef.current = false;
      setReplaceMode(false);
      setStackMode(false);
      pendingRecordingColor.current = null;
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
  const recordingTimelineTime =
    recordingStartTime.current + engineState.recordingDuration;
  const monitorMixPreparing =
    isRecording &&
    engineState.monitorMixActive &&
    !engineState.monitorMixReady;

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    void (async () => {
      await cancelEditDraft();
      setActiveEditor(null);
    })();
  }, [cancelEditDraft, isRecording]);

  useEffect(() => {
    if (!isRecording || !engineState.monitorMixActive) {
      return;
    }

    return subscribeHeadphoneDisconnect(() => {
      void cancelActiveRecording().then(() => {
        Alert.alert(
          'Headphones disconnected',
          'Recording stopped. Connect headphones to stack tracks.'
        );
      });
    });
  }, [cancelActiveRecording, engineState.monitorMixActive, isRecording]);

  const showTrackEditor =
    !isRecording &&
    Boolean(activeLayer && activeLayer.duration > 0 && !activeLayerEffects?.muted);

  const availableTools = useMemo((): EditorTool[] => {
    const base: EditorTool[] = ['trim', 'volume', 'reverb', 'delay', 'eq'];
    if (memo && getPlayableLayers(memo).length > 1) {
      return ['trim', 'move', 'volume', 'reverb', 'delay', 'eq'];
    }
    return base;
  }, [memo]);

  useEffect(() => {
    if (activeEditor === 'move' && memo && getPlayableLayers(memo).length <= 1) {
      setActiveEditor(null);
    }
  }, [activeEditor, memo]);

  useEffect(() => {
    if (!memo || !activeLayerId) {
      return;
    }
    const layer = memo.layers.find((entry) => entry.id === activeLayerId);
    if (layer && getLayerEffects(layer).muted) {
      setActiveLayerId(null);
      setActiveEditor(null);
    }
  }, [activeLayerId, memo]);

  const blockSheetGesture =
    activeEditor === 'eq' && activeLayerEffects?.eq.preset === 'custom';

  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: !blockSheetGesture });
  }, [navigation, blockSheetGesture]);

  const waveformDuration = isRecording
    ? Math.max(duration, recordingTimelineTime, 0.01)
    : duration;
  const waveformCurrentTime = isRecording ? recordingTimelineTime : currentTime;

  const waveformTracks = useMemo((): TrackData[] => {
    if (!memo) {
      return [];
    }

    const playableTracks = [...memo.layers]
      .filter((layer) => layer.duration > 0)
      .sort((a, b) => b.order - a.order)
      .map((layer) => {
        const trackMeta = {
          label: layer.label,
          showLabel: true,
          color: resolveTrackColor(layer.color),
        };
        const isTrimEditing =
          activeEditor === 'trim' && !savingTrim && layer.id === activeLayerId;
        const isMoveEditing = activeEditor === 'move' && layer.id === activeLayerId;

        if (isTrimEditing) {
          const effects = getLayerEffects(layer);
          return {
            id: layer.id,
            peaks: layer.waveformPeaks,
            startTime: layer.startTime,
            duration: layer.duration,
            isActive: !effects.muted,
            isMuted: effects.muted,
            ...trackMeta,
          };
        }

        if (isMoveEditing) {
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
            isActive: !effects.muted,
            isMuted: effects.muted,
            ...trackMeta,
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
          isActive: layer.id === activeLayerId && !effects.muted,
          isMuted: effects.muted,
          ...trackMeta,
        };
      });

    if (isRecording) {
      const recordingColor = stackMode
        ? (pendingRecordingColor.current ?? undefined)
        : resolveTrackColor(memo.layers[0]?.color);
      const recordingTrack: TrackData = {
        id: '__recording__',
        peaks:
          engineState.recordingPeaks.length > 0 ? engineState.recordingPeaks : undefined,
        startTime: replaceMode || stackMode ? recordingStartTime.current : 0,
        duration: Math.max(engineState.recordingDuration, 0.01),
        isActive: true,
        color: recordingColor,
      };

      if (stackMode) {
        return [recordingTrack, ...playableTracks.map((track) => ({ ...track, isActive: false }))];
      }

      if (replaceMode && activeLayerId) {
        const replaceStart = recordingStartTime.current;
        return playableTracks.map((track) => {
          if (track.id !== activeLayerId) {
            return {
              ...track,
              isActive: false,
            };
          }

          const keptDuration = Math.max(0.01, replaceStart - track.startTime);
          const prefixPeaks =
            keptDuration < track.duration && track.peaks && track.peaks.length > 0
              ? track.peaks.slice(
                  0,
                  Math.max(
                    1,
                    Math.ceil((keptDuration / track.duration) * track.peaks.length)
                  )
                )
              : track.peaks;

          return {
            ...track,
            isActive: true,
            peaks: prefixPeaks,
            duration: Math.min(track.duration, keptDuration),
            liveRecording: {
              peaks:
                engineState.recordingPeaks.length > 0
                  ? engineState.recordingPeaks
                  : undefined,
              startTime: replaceStart,
              duration: Math.max(engineState.recordingDuration, 0.01),
            },
            replaceTailDimFrom: replaceStart,
          };
        });
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
          color: resolveTrackColor(memo.layers[0]?.color),
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
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const recordingLabel = monitorMixPreparing
    ? 'Preparing monitor…'
    : stackMode
      ? 'Recording stack…'
      : replaceMode
        ? 'Recording replacement…'
        : 'Recording…';
  const colorPickerLayer = colorPickerLayerId
    ? memo.layers.find((entry) => entry.id === colorPickerLayerId)
    : null;

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.tracksArea}>
          <WaveformView
            currentTime={waveformCurrentTime}
            duration={waveformDuration}
            getPlaybackTime={() => engine.getPlaybackTime()}
            getRecordingTime={() =>
              recordingStartTime.current + engine.getRecordingDuration()
            }
            isPlaying={engineState.isPlaying && !monitorMixPreparing}
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
            moveOverlay={
              activeEditor === 'move' && activeLayer && activeLayerEffects
                ? {
                    layerId: activeLayer.id,
                    startTime: activeLayer.startTime,
                    trimIn: activeLayerEffects.trimIn,
                    onChange: handleLayerStartTimeChange,
                  }
                : undefined
            }
            volumeVisualDb={
              activeEditor === 'volume' && activeLayerEffects
                ? activeLayerEffects.volumeDb
                : undefined
            }
            loopOverlay={
              memo && waveformDuration > 0
                ? {
                    loopStart: memo.loopStart ?? 0,
                    loopEnd: memo.loopEnd ?? 0,
                    loopEnabled: memo.loopEnabled ?? false,
                    duration: waveformDuration,
                    onChange: handleLoopChange,
                  }
                : undefined
            }
            onSeek={(time) => {
              if (!isRecording) {
                engine.seek(time);
              }
            }}
            onTrackPress={handleTrackPress}
            onTrackDeselect={handleTrackDeselect}
            onTrackLongPress={showTrackOptions}
          />
        </View>

        {activeLayerEffects ? (
          <TrackEditorShell
            activeTool={activeEditor}
            availableTools={availableTools}
            effects={activeLayerEffects}
            layerDuration={activeLayer?.duration ?? 0}
            visible={showTrackEditor}
            onCancelDraft={handleCancelDraft}
            onConfirmDraft={handleConfirmDraft}
            onEffectsChange={handleEffectsChange}
            onToolChange={handleEditorToolChange}
          />
        ) : null}

        <View style={styles.footer}>
          <View style={styles.timeDisplay}>
            <Text style={styles.largeTime}>
              {formatDurationWithTenths(
                isRecording ? recordingTimelineTime : currentTime
              )}
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
      <TrackColorPicker
        selectedColor={resolveTrackColor(colorPickerLayer?.color)}
        visible={colorPickerLayerId !== null}
        onClose={() => setColorPickerLayerId(null)}
        onSelect={handleTrackColorSelect}
      />
    </SafeAreaView>
  );
}

function useMemoEditorStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const moreButtonBackground =
    colorScheme === 'dark' ? colors.pillBackground : colors.searchFieldBackground;

  return useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: colors.sheetBackground,
        },
        content: {
          flex: 1,
          paddingHorizontal: 20,
        },
        centered: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.sheetBackground,
        },
        doneButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        },
        doneButtonDisabled: {
          opacity: 0.4,
        },
        headerBar: {
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
          paddingHorizontal: 8,
          gap: 8,
        },
        moreButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          backgroundColor: moreButtonBackground,
          alignItems: 'center',
          justifyContent: 'center',
        },
        headerTitle: {
          flex: 1,
          fontSize: 17,
          fontWeight: '500',
          color: colors.text,
          padding: 0,
          textAlign: 'center',
        },
        tracksArea: {
          flex: 1,
          marginHorizontal: -20,
          paddingTop: 4,
        },
        timeDisplay: {
          alignItems: 'center',
          gap: 4,
          paddingBottom: 4,
        },
        largeTime: {
          fontSize: 36,
          fontWeight: '300',
          color: colors.text,
          fontVariant: ['tabular-nums'],
        },
        recordingLabel: {
          fontSize: 15,
          color: colors.secondaryText,
        },
        footer: {
          paddingTop: 8,
          paddingBottom: 8,
          gap: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
        },
        stopButton: {
          alignSelf: 'center',
          width: 72,
          height: 72,
          borderRadius: 36,
          borderWidth: 4,
          borderColor: colors.separator,
          alignItems: 'center',
          justifyContent: 'center',
        },
        stopSquare: {
          width: 24,
          height: 24,
          borderRadius: 4,
          backgroundColor: colors.recordRed,
        },
      }),
    [colors, moreButtonBackground]
  );
}
