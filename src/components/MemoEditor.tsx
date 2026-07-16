import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { DEFAULT_TRACK_COLOR, pickRandomTrackColor } from '@/constants/VoiceMemosColors';
import { showMemoActionSheet } from '@/src/actions/showMemoActionSheet';
import { shareMemo } from '@/src/actions/shareMemo';
import { useAudioEngine, useAudioEngineState } from '@/src/audio/AudioEngineContext';
import {
  isHeadphonesConnected,
  needsMonitorMix,
  requiresHeadphones,
  subscribeHeadphoneDisconnect,
  useHeadphonesConnected,
} from '@/src/audio/headphoneDetection';
import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';
import { hasAnySoloActive, isLayerSelectable, mergeLayerEffects } from '@/src/audio/layerEffects';
import {
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
} from '@/src/audio/performanceWarning';
import { slicePeaksForTrim } from '@/src/audio/waveform';
import { MetronomeButton } from '@/src/components/MetronomeButton';
import { MetronomeSettingsSheet } from '@/src/components/MetronomeSettingsSheet';
import { PlaybackControls } from '@/src/components/PlaybackControls';
import { TrackEditorShell } from '@/src/components/track-editor/TrackEditorShell';
import type { EditorTool } from '@/src/components/track-editor/types';
import { resolveTrackColor, TrackColorPicker } from '@/src/components/TrackColorPicker';
import { WaveformView, type TrackData } from '@/src/components/WaveformView';
import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';
import { applyLocationTitleIfEnabled } from '@/src/location/locationNaming';
import {
  awaitSaveInFlight,
  beginSession,
  clearSession,
  getSession,
  stopAndSave,
  subscribeRecordingSave,
} from '@/src/recording/activeRecordingSession';
import { subscribeMemoUpdate } from '@/src/recording/memoUpdateEvents';
import {
  deactivateMemoLoop,
  deleteLayer,
  deleteMemo,
  duplicateMemo,
  ensureWaveformPeaks,
  getMemo,
  permanentlyDeleteMemo,
  updateLayerColor,
  updateLayerEffects,
  updateLayerLabel,
  updateLayerStartTimes,
  updateLoopRegion,
  updateMetronomeSettings,
  updateTitle,
} from '@/src/storage/memoStore';
import { isMemoInTrash } from '@/src/storage/paths';
import type { Layer, Memo, MetronomeSettings } from '@/src/storage/types';
import {
  applyTimelineDeltaToLayers,
  clampLayerStartTime,
  getEarliestTrimInTimelineDelta,
  getLayerActiveDuration,
  getLayerActiveStartTime,
  getLayerEffects,
  getMemoMetronomeSettings,
  getMemoTimelineDuration,
  getPlayableLayers,
  hasRecording,
  normalizeMetronomeSettings,
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDurationWithTenths } from '@/src/utils/format';

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

function suppressTrackSelection(tracks: TrackData[], isRecording: boolean): TrackData[] {
  return isRecording
    ? tracks.map((track) => ({ ...track, isActive: false }))
    : tracks;
}

export type MemoEditorPresentation = 'sheet' | 'pane';

export type MemoEditorProps = {
  memoId: string;
  /** When true, start recording once the empty memo is loaded (same as ?record=1). */
  autoRecord?: boolean;
  presentation?: MemoEditorPresentation;
  backTitle?: string;
  onDismiss: () => void;
  /** Called when the editor navigates to a different memo (e.g. after duplicate). */
  onMemoIdChange?: (memoId: string) => void;
  /** Called after autoRecord has been consumed (started or aborted). */
  onAutoRecordConsumed?: () => void;
};

export function MemoEditor({
  memoId: id,
  autoRecord = false,
  presentation = 'sheet',
  backTitle,
  onDismiss,
  onMemoIdChange,
  onAutoRecordConsumed,
}: MemoEditorProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useMemoEditorStyles(colors, colorScheme);
  const isPane = presentation === 'pane';
  const record = autoRecord ? '1' : undefined;
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineState();
  const headphonesConnected = useHeadphonesConnected();
  const autoRecordStarted = useRef(false);
  const beginRecordingInFlight = useRef(false);
  const pendingLocationNamingRef = useRef(false);
  const recordingStartTime = useRef(0);
  const persistEffectsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistStartTimeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistLoopTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistMetronomeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetronomePersist = useRef<{
    memoId: string;
    settings: MetronomeSettings;
  } | null>(null);
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
  const [metronomeSettingsVisible, setMetronomeSettingsVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const lastLayoutHeightRef = useRef<number | null>(null);
  const settleRafRef = useRef<number | null>(null);
  const stackModeRef = useRef(false);
  const replaceModeRef = useRef(false);
  const activeLayerIdRef = useRef<string | null>(null);
  const isSavingRecordingOnExit = useRef(false);
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
          solo: nextEffects!.solo,
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
      solo: pending.effects.solo,
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
            solo: effects.solo,
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

  const flushMetronomePersist = useCallback(() => {
    if (persistMetronomeTimeout.current) {
      clearTimeout(persistMetronomeTimeout.current);
      persistMetronomeTimeout.current = null;
    }
    const pending = pendingMetronomePersist.current;
    if (pending) {
      pendingMetronomePersist.current = null;
      void updateMetronomeSettings(pending.memoId, pending.settings);
    }
  }, []);

  const handleMetronomeChange = useCallback(
    (partial: Partial<MetronomeSettings>) => {
      if (!memo) {
        return;
      }
      const next = normalizeMetronomeSettings({
        ...getMemoMetronomeSettings(memo),
        ...partial,
      });
      setMemo({ ...memo, metronome: next });
      engine.setMetronome(next);
      pendingMetronomePersist.current = { memoId: memo.id, settings: next };

      if (persistMetronomeTimeout.current) {
        clearTimeout(persistMetronomeTimeout.current);
      }
      persistMetronomeTimeout.current = setTimeout(() => {
        flushMetronomePersist();
      }, 300);
    },
    [engine, flushMetronomePersist, memo]
  );

  const handleMetronomeToggle = useCallback(() => {
    if (!memo) {
      return;
    }
    handleMetronomeChange({ enabled: !getMemoMetronomeSettings(memo).enabled });
  }, [handleMetronomeChange, memo]);

  const handleTrackPress = useCallback(
    (trackId: string) => {
      if (trackId === activeLayerId || savingTrim) {
        return;
      }

      const layer = memo?.layers.find((entry) => entry.id === trackId);
      const anySoloActive = memo
        ? hasAnySoloActive(memo.layers.map((entry) => getLayerEffects(entry)))
        : false;
      if (layer && !isLayerSelectable(getLayerEffects(layer), anySoloActive)) {
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
      const anySoloActive = hasAnySoloActive(
        memo.layers.map((entry) => getLayerEffects(entry))
      );
      const muteLabel = effects.muted ? 'Unmute' : 'Mute';
      const soloLabel = effects.solo ? 'Unsolo' : 'Solo';
      const canDelete = getPlayableLayers(memo).length > 1;
      const options = canDelete
        ? ['Rename Track', 'Change Color', muteLabel, soloLabel, 'Delete Track', 'Cancel']
        : ['Rename Track', 'Change Color', muteLabel, soloLabel, 'Cancel'];
      const destructiveButtonIndex = canDelete ? 4 : undefined;
      const cancelButtonIndex = canDelete ? 5 : 4;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        (index) => {
          if (index === 0) {
            if (layerId !== activeLayerId && isLayerSelectable(effects, anySoloActive)) {
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
            if (layerId !== activeLayerId && isLayerSelectable(effects, anySoloActive)) {
              setActiveLayerId(layerId);
            }
            setColorPickerLayerId(layerId);
            return;
          }
          if (index === 2) {
            applyLayerEffectsChange(layerId, { muted: !effects.muted });
            return;
          }
          if (index === 3) {
            applyLayerEffectsChange(layerId, { solo: !effects.solo });
            return;
          }
          if (canDelete && index === 4) {
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
      const anySoloActive = hasAnySoloActive(
        loaded.layers.map((entry) => getLayerEffects(entry))
      );
      const defaultLayer = loaded.layers.find(
        (layer) =>
          layer.duration > 0 && isLayerSelectable(getLayerEffects(layer), anySoloActive)
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
    if (!id) {
      return;
    }

    return subscribeRecordingSave((result) => {
      if (result.memo.id !== id) {
        return;
      }

      setMemo(result.memo);
      setActiveLayerId(result.activeLayerId);
      setReplaceMode(false);
      setStackMode(false);
      monitorMixRef.current = false;
      pendingRecordingColor.current = null;
    });
  }, [id]);

  useEffect(() => {
    if (!id) {
      return;
    }

    return subscribeMemoUpdate((memo) => {
      if (memo.id !== id) {
        return;
      }
      setMemo(memo);
    });
  }, [id]);

  useEffect(() => {
    autoRecordStarted.current = false;
  }, [id]);

  useEffect(() => {
    if (autoRecordStarted.current) {
      return;
    }
    if (record !== '1' || !memo || hasRecording(memo)) {
      return;
    }

    const existingSession = getSession();
    if (
      engine.getState().isRecording ||
      (existingSession && existingSession.memoId !== memo.id)
    ) {
      autoRecordStarted.current = true;
      onAutoRecordConsumed?.();
      onDismiss();
      void deleteMemo(memo.id);
      return;
    }

    autoRecordStarted.current = true;
    pendingLocationNamingRef.current = true;
    onAutoRecordConsumed?.();
    beginSession({
      memoId: memo.id,
      memoTitle: memo.title,
      mode: 'new',
      layerId: null,
      startTime: 0,
      trackColor: null,
    });
    void engine.startRecording().catch((error: Error) => {
      clearSession();
      Alert.alert('Recording failed', error.message);
    });
  }, [engine, memo, onAutoRecordConsumed, onDismiss, record]);

  const stopAndSaveActiveRecording = useCallback(
    async (options?: { reloadEngine?: boolean }): Promise<boolean> => {
      const existingResult = await awaitSaveInFlight();
      if (existingResult) {
        return true;
      }

      if (!engine.getState().isRecording) {
        return true;
      }

      if (!memoRef.current) {
        return false;
      }

      isSavingRecordingOnExit.current = true;
      try {
        const result = await stopAndSave(engine, options);
        if (!result) {
          Alert.alert(
            'Could not save recording',
            'The recording session could not be restored.'
          );
          return false;
        }

        setMemo(result.memo);
        setActiveLayerId(result.activeLayerId);
        setReplaceMode(false);
        setStackMode(false);
        monitorMixRef.current = false;
        pendingRecordingColor.current = null;
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
    const applyPendingLocationNaming = () => {
      if (!pendingLocationNamingRef.current || !id) {
        return;
      }
      pendingLocationNamingRef.current = false;
      void applyLocationTitleIfEnabled(id);
    };

    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isSavingRecordingOnExit.current) {
        e.preventDefault();
        return;
      }

      if (!engine.getState().isRecording) {
        applyPendingLocationNaming();
        return;
      }

      e.preventDefault();
      void stopAndSaveActiveRecording({ reloadEngine: false }).then((ok) => {
        if (ok) {
          applyPendingLocationNaming();
          navigation.dispatch(e.data.action);
        }
      });
    });

    return unsubscribe;
  }, [engine, id, navigation, stopAndSaveActiveRecording]);

  const resetLayoutReady = useCallback(() => {
    setLayoutReady(false);
    lastLayoutHeightRef.current = null;
    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
  }, []);

  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (height <= 0) {
      return;
    }

    const previous = lastLayoutHeightRef.current;
    lastLayoutHeightRef.current = height;

    if (previous === height) {
      setLayoutReady(true);
      return;
    }

    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
    }
    settleRafRef.current = requestAnimationFrame(() => {
      settleRafRef.current = null;
      if (lastLayoutHeightRef.current === height) {
        setLayoutReady(true);
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', resetLayoutReady);
    return unsubscribe;
  }, [navigation, resetLayoutReady]);

  useEffect(() => {
    void loadMemo();
    return () => {
      resetLayoutReady();
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
      flushMetronomePersist();
      const current = memoRef.current;
      if (current) {
        deactivateLoopForMemo(engine, current, setMemo);
      }
    };
  }, [engine, flushMetronomePersist, loadMemo, resetLayoutReady]);

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
    flushMetronomePersist();
    if (persistLoopTimeout.current) {
      clearTimeout(persistLoopTimeout.current);
      persistLoopTimeout.current = null;
    }
    const current = memoRef.current;
    if (current) {
      deactivateLoopForMemo(engine, current, setMemo);
    }
    if (pendingLocationNamingRef.current) {
      pendingLocationNamingRef.current = false;
      void applyLocationTitleIfEnabled(memo.id);
    }
    onDismiss();
  }, [
    cancelEditDraft,
    engine,
    flushEffectsPersist,
    flushMetronomePersist,
    flushStartTimePersist,
    memo,
    onDismiss,
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
    flushMetronomePersist();
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
    flushMetronomePersist,
    flushStartTimePersist,
    memo,
    stopAndSaveActiveRecording,
  ]);

  const handleShare = useCallback(() => {
    if (!memo) {
      return;
    }
    shareMemo(memo, {
      onExportStarted: () => setIsExporting(true),
      onExportFinished: () => setIsExporting(false),
    });
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
    if (onMemoIdChange) {
      onMemoIdChange(duplicated.id);
    } else {
      router.replace({ pathname: '/memo/[id]', params: { id: duplicated.id } });
    }
  }, [engine, flushEditorState, memo, onMemoIdChange]);

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
            onDismiss();
          })();
        },
      },
    ]
    );
  }, [engine, flushEditorState, memo, onDismiss]);

  const showMemoMenu = useCallback(() => {
    showMemoActionSheet({
      includeEditRecording: false,
      includeShare: memo ? hasRecording(memo) : false,
      onShare: handleShare,
      onRename: handleRename,
      onDuplicate: () => void handleDuplicate(),
      onDelete: confirmDelete,
    });
  }, [confirmDelete, handleDuplicate, handleRename, handleShare, memo]);

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
    if (isPane) {
      return;
    }
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
  }, [backTitle, colors, isPane, navigation, renderHeaderBar]);

  const handleStopRecording = () => {
    void stopAndSaveActiveRecording();
  };

  const beginRecording = async (mode: 'replace' | 'stack') => {
    if (!memo || !hasRecording(memo)) {
      return;
    }

    if (beginRecordingInFlight.current || engine.getState().isRecording) {
      return;
    }

    if (memo.loopEnabled) {
      Alert.alert(
        'Turn off loop to record',
        'Recording isn’t available while a loop is active. Disable the loop, then try again.'
      );
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

    beginRecordingInFlight.current = true;
    try {
      if (requiresHeadphones(memo, mode) && !(await isHeadphonesConnected())) {
        Alert.alert(
          'Connect headphones',
          'Plug in earbuds or headphones to record over existing tracks. Audio plays through your headphones; recording uses your iPhone microphone.'
        );
        return;
      }

      if (engine.getState().isRecording) {
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
          startTime = Math.max(activeStart, startTime);
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

      beginSession({
        memoId: memo.id,
        memoTitle: memo.title,
        mode,
        layerId: activeLayerId,
        startTime,
        trackColor: pendingRecordingColor.current,
      });

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
        clearSession();
        Alert.alert('Recording failed', error instanceof Error ? error.message : 'Unknown error');
      }
    } finally {
      beginRecordingInFlight.current = false;
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

    if (memo.loopEnabled) {
      Alert.alert(
        'Turn off loop to record',
        'Recording isn’t available while a loop is active. Disable the loop, then try again.'
      );
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
  const pendingRecordingLayout = stackMode || replaceMode || isRecording;
  const currentTime = memo && isActiveMemo ? engineState.currentTime : 0;
  const recordingTimelineTime =
    recordingStartTime.current + engineState.recordingDuration;
  const pendingTimelineTime = recordingStartTime.current;
  const monitorMixPreparing =
    isRecording &&
    engineState.monitorMixActive &&
    !engineState.monitorMixReady;

  useEffect(() => {
    if (!pendingRecordingLayout) {
      return;
    }
    void (async () => {
      await cancelEditDraft();
      setActiveEditor(null);
    })();
  }, [cancelEditDraft, pendingRecordingLayout]);

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

  useEffect(() => {
    if (!memo?.metronome?.enabled) {
      return;
    }

    return subscribeHeadphoneDisconnect(() => {
      const current = memoRef.current;
      if (!current?.metronome?.enabled) {
        return;
      }
      const next = normalizeMetronomeSettings({
        ...getMemoMetronomeSettings(current),
        enabled: false,
      });
      setMemo({ ...current, metronome: next });
      engine.setMetronome(next);
      void updateMetronomeSettings(current.id, { enabled: false });
      Alert.alert(
        'Headphones disconnected',
        'Metronome turned off. Connect headphones to use it.'
      );
    });
  }, [engine, memo?.metronome?.enabled]);

  const showTrackEditor =
    !pendingRecordingLayout &&
    Boolean(
      activeLayer &&
        activeLayer.duration > 0 &&
        activeLayerEffects &&
        isLayerSelectable(
          activeLayerEffects,
          memo
            ? hasAnySoloActive(memo.layers.map((entry) => getLayerEffects(entry)))
            : false
        )
    );

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
    const anySoloActive = hasAnySoloActive(
      memo.layers.map((entry) => getLayerEffects(entry))
    );
    if (layer && !isLayerSelectable(getLayerEffects(layer), anySoloActive)) {
      setActiveLayerId(null);
      setActiveEditor(null);
    }
  }, [activeLayerId, memo]);

  const blockSheetGesture =
    activeEditor === 'eq' && activeLayerEffects?.eq.preset === 'custom';

  useLayoutEffect(() => {
    if (isPane) {
      return;
    }
    navigation.setOptions({ gestureEnabled: !blockSheetGesture });
  }, [navigation, blockSheetGesture, isPane]);

  const waveformDuration = pendingRecordingLayout
    ? Math.max(
        duration,
        isRecording ? recordingTimelineTime : pendingTimelineTime,
        0.01
      )
    : duration;
  const waveformCurrentTime = pendingRecordingLayout
    ? isRecording
      ? recordingTimelineTime
      : pendingTimelineTime
    : currentTime;
  const metronomeSettings = useMemo(
    () => (memo ? getMemoMetronomeSettings(memo) : normalizeMetronomeSettings()),
    [memo]
  );

  const playableTrackRows = useMemo((): TrackData[] => {
    if (!memo) {
      return [];
    }

    const anySoloActive = hasAnySoloActive(
      memo.layers.map((entry) => getLayerEffects(entry))
    );

    return [...memo.layers]
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
          const selectable = isLayerSelectable(effects, anySoloActive);
          return {
            id: layer.id,
            peaks: layer.waveformPeaks,
            startTime: layer.startTime,
            duration: layer.duration,
            isActive: layer.id === activeLayerId && selectable,
            isMuted: effects.muted,
            isSoloed: effects.solo,
            isSoloedOut: anySoloActive && !effects.solo,
            ...trackMeta,
          };
        }

        if (isMoveEditing) {
          const effects = getLayerEffects(layer);
          const activeDuration = getLayerActiveDuration(layer);
          const selectable = isLayerSelectable(effects, anySoloActive);

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
            isActive: layer.id === activeLayerId && selectable,
            isMuted: effects.muted,
            isSoloed: effects.solo,
            isSoloedOut: anySoloActive && !effects.solo,
            ...trackMeta,
          };
        }

        const effects = getLayerEffects(layer);
        const activeDuration = getLayerActiveDuration(layer);
        const selectable = isLayerSelectable(effects, anySoloActive);

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
          isActive: layer.id === activeLayerId && selectable,
          isMuted: effects.muted,
          isSoloed: effects.solo,
          isSoloedOut: anySoloActive && !effects.solo,
          ...trackMeta,
        };
      });
  }, [activeEditor, activeLayerId, memo, savingTrim]);

  const inactivePlayableTracks = useMemo(
    () => playableTrackRows.map((track) => ({ ...track, isActive: false })),
    [playableTrackRows]
  );

  const inactivePlayableById = useMemo(() => {
    const map = new Map<string, TrackData>();
    for (const track of inactivePlayableTracks) {
      map.set(track.id, track);
    }
    return map;
  }, [inactivePlayableTracks]);

  const waveformTracks = useMemo((): TrackData[] => {
    if (!memo) {
      return [];
    }

    let tracks: TrackData[];

    if (pendingRecordingLayout) {
      const recordingColor = stackMode
        ? (pendingRecordingColor.current ?? undefined)
        : resolveTrackColor(memo.layers[0]?.color);
      const recordingDuration = isRecording
        ? Math.max(engineState.recordingDuration, 0.01)
        : 0.01;
      const recordingPeaks =
        isRecording && engineState.recordingPeaks.length > 0
          ? engineState.recordingPeaks
          : undefined;
      const recordingTrack: TrackData = {
        id: '__recording__',
        peaks: recordingPeaks,
        startTime: replaceMode || stackMode ? recordingStartTime.current : 0,
        duration: recordingDuration,
        isActive: true,
        color: recordingColor,
      };

      if (stackMode) {
        tracks = [recordingTrack, ...inactivePlayableTracks];
      } else if (replaceMode && activeLayerId) {
        const replaceStart = recordingStartTime.current;
        tracks = playableTrackRows.map((track) => {
          if (track.id !== activeLayerId) {
            return inactivePlayableById.get(track.id) ?? { ...track, isActive: false };
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
            ...(isRecording
              ? {
                  liveRecording: {
                    peaks: recordingPeaks,
                    startTime: replaceStart,
                    duration: recordingDuration,
                  },
                }
              : {}),
            replaceTailDimFrom: replaceStart,
          };
        });
      } else {
        tracks = [recordingTrack];
      }
    } else if (playableTrackRows.length === 0) {
      tracks = [
        {
          id: memo.layers[0]?.id ?? 'empty',
          peaks: undefined,
          startTime: 0,
          duration: duration > 0 ? duration : 0.01,
          isActive: true,
          color: resolveTrackColor(memo.layers[0]?.color),
        },
      ];
    } else {
      tracks = playableTrackRows;
    }

    return suppressTrackSelection(tracks, isRecording);
  }, [
    activeLayerId,
    duration,
    engineState.recordingDuration,
    engineState.recordingPeaks,
    inactivePlayableById,
    inactivePlayableTracks,
    isRecording,
    memo,
    pendingRecordingLayout,
    playableTrackRows,
    replaceMode,
    stackMode,
  ]);

  const colorPickerLayer = colorPickerLayerId
    ? memo?.layers.find((entry) => entry.id === colorPickerLayerId)
    : null;
  const showEditorContent = Boolean(memo && !loading);

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      {isPane ? <View style={styles.paneHeader}>{renderHeaderBar()}</View> : null}
      <View onLayout={handleContentLayout} style={styles.content}>
        <View style={styles.tracksArea}>
          {showEditorContent ? (
            <WaveformView
              currentTime={waveformCurrentTime}
              duration={waveformDuration}
              getPlaybackTime={() => engine.getPlaybackTime()}
              getRecordingTime={() =>
                recordingStartTime.current + engine.getRecordingDuration()
              }
              isPlaying={engineState.isPlaying && !monitorMixPreparing}
              isRecording={isRecording}
              recordingLayoutActive={pendingRecordingLayout}
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
          ) : (
            <View style={styles.tracksLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}
        </View>

        {layoutReady && showEditorContent ? (
          <>
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
                <View style={styles.timeDisplaySide}>
                  <MetronomeButton
                    headphonesConnected={headphonesConnected}
                    settings={metronomeSettings}
                    onOpenSettings={() => setMetronomeSettingsVisible(true)}
                    onToggle={handleMetronomeToggle}
                  />
                </View>
                <Text style={styles.largeTime}>
                  {formatDurationWithTenths(
                    pendingRecordingLayout ? waveformCurrentTime : currentTime
                  )}
                </Text>
                <View style={styles.timeDisplaySide} />
              </View>

              <PlaybackControls
                currentTime={currentTime}
                duration={duration}
                isPlaying={engineState.isPlaying}
                isRecording={pendingRecordingLayout}
                recordDisabled={!memo || !hasRecording(memo)}
                showProgressBar={false}
                showTimeLabels={false}
                stopRecordingDisabled={!isRecording}
                onPlayPause={() => void handlePlayPause()}
                onRecordPress={showRecordOptions}
                onSkipBack={() => engine.skip(-15)}
                onSkipForward={() => engine.skip(15)}
                onStopRecording={() => void handleStopRecording()}
              />
            </View>
          </>
        ) : null}
      </View>
      <TrackColorPicker
        selectedColor={resolveTrackColor(colorPickerLayer?.color)}
        visible={colorPickerLayerId !== null}
        onClose={() => setColorPickerLayerId(null)}
        onSelect={handleTrackColorSelect}
      />
      <MetronomeSettingsSheet
        settings={metronomeSettings}
        visible={metronomeSettingsVisible}
        onChange={handleMetronomeChange}
        onClose={() => setMetronomeSettingsVisible(false)}
      />
      <Modal animationType="fade" transparent visible={isExporting}>
        <View style={styles.exportOverlay}>
          <View style={styles.exportCard}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.exportText}>Preparing audio…</Text>
          </View>
        </View>
      </Modal>
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
        paneHeader: {
          paddingTop: 8,
          paddingBottom: 8,
        },
        content: {
          flex: 1,
          paddingHorizontal: 20,
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
        tracksLoading: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        timeDisplay: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingBottom: 4,
        },
        timeDisplaySide: {
          width: 32,
        },
        largeTime: {
          flex: 1,
          fontSize: 36,
          fontWeight: '300',
          color: colors.text,
          fontVariant: ['tabular-nums'],
          textAlign: 'center',
        },
        footer: {
          marginHorizontal: -20,
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 8,
          gap: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
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
    [colors, moreButtonBackground]
  );
}
