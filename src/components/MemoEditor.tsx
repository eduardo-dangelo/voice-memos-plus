import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_TRACK_COLOR, pickRandomTrackColor } from '@/constants/VoiceMemosColors';
import { shareMemo } from '@/src/actions/shareMemo';
import { useAudioEngine, useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import { RecordingStartAbortedError, type EngineState } from '@/src/audio/MemoAudioEngine';
import {
  isHeadphonesConnected,
  needsMonitorMix,
  requiresHeadphones,
  subscribeHeadphoneDisconnect,
  subscribeHeadphonesConnected,
} from '@/src/audio/headphoneDetection';
import { getClickIntervalSec, getQuarterIntervalSec } from '@/src/audio/metronome';
import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';
import { hasAnySoloActive, isLayerSelectable, mergeLayerEffects } from '@/src/audio/layerEffects';
import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';
import {
  canMergeLayers,
  getMergePartnerLayers,
  getPlayableLayersInTimelineOrder,
} from '@/src/audio/mergeLayersLogic';
import {
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
} from '@/src/audio/performanceWarning';
import { getRecordingReplacementSkipSeconds } from '@/src/audio/recordingLatency';
import {
  slicePeaksForTrim,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import { FloatingHeaderButton, FloatingHeaderIconFace } from '@/src/components/FloatingHeaderButton';
import { IconActionSheet, type IconActionSheetItem } from '@/src/components/IconActionSheet';
import { LoopSettingsSheet } from '@/src/components/LoopSettingsSheet';
import { MemoOptionsMenu } from '@/src/components/MemoOptionsMenu';
import { MetronomeButton } from '@/src/components/MetronomeButton';
import { MetronomeSettingsSheet } from '@/src/components/MetronomeSettingsSheet';
import { NamePromptDialog } from '@/src/components/NamePromptDialog';
import { PlaybackControls } from '@/src/components/PlaybackControls';
import { PrecountButton } from '@/src/components/PrecountButton';
import { PrecountOverlay } from '@/src/components/PrecountOverlay';
import { TrackEditorShell } from '@/src/components/track-editor/TrackEditorShell';
import type { EditorTool } from '@/src/components/track-editor/types';
import { resolveTrackColor, TrackColorPicker } from '@/src/components/TrackColorPicker';
import { WaveformView, type TrackData } from '@/src/components/WaveformView';
import { applyLocationTitleIfEnabled } from '@/src/location/locationNaming';
import {
  awaitSaveInFlight,
  beginSession,
  clearSession,
  getLastDiscardedMemoId,
  getSession,
  stopAndSave,
  subscribeRecordingSave,
} from '@/src/recording/activeRecordingSession';
import { decideAutoRecord } from '@/src/recording/autoRecordGate';
import { consumeAutoRecordIntent } from '@/src/recording/autoRecordIntent';
import { ensureRecordingBootstrapComplete } from '@/src/recording/recordingBootstrap';
import { subscribeMemoUpdate } from '@/src/recording/memoUpdateEvents';
import {
  deactivateMemoLoop,
  deleteLayer,
  deleteMemo,
  duplicateMemo,
  ensureWaveformPeaks,
  getMemo,
  mergeLayers,
  permanentlyDeleteMemo,
  updateLayerColor,
  updateLayerEffects,
  updateLayerLabel,
  updateLayerStartTimes,
  updateLoopRegion,
  updateMetronomeSettings,
  updatePrecountMode,
  updateTitle,
} from '@/src/storage/memoStore';
import { isMemoInTrash } from '@/src/storage/paths';
import type { Layer, Memo, MetronomeSettings, PrecountMode } from '@/src/storage/types';
import {
  applyTimelineDeltaToLayers,
  clampLayerStartTime,
  getEarliestTrimInTimelineDelta,
  getLayerActiveDuration,
  getLayerActiveStartTime,
  getLayerEffects,
  getMemoMetronomeSettings,
  getMemoPrecountMode,
  getMemoTimelineDuration,
  getPlayableLayers,
  hasRecording,
  nextMetronomeMode,
  nextPrecountMode,
  normalizeMetronomeSettings,
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDurationWithTenths } from '@/src/utils/format';

type MemoEditorEngineSlice = {
  memoId: string | null;
  isRecording: boolean;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  monitorMixActive: boolean;
  monitorMixReady: boolean;
  recordingDuration: number;
};

function selectMemoEditorEngine(state: EngineState): MemoEditorEngineSlice {
  return {
    memoId: state.memoId,
    isRecording: state.isRecording,
    isPlaying: state.isPlaying,
    duration: state.duration,
    currentTime: state.currentTime,
    monitorMixActive: state.monitorMixActive,
    monitorMixReady: state.monitorMixReady,
    recordingDuration: state.recordingDuration,
  };
}

/** Skip currentTime ticks while playing; recording peaks update via LiveRecordingWaveform. */
function areMemoEditorEngineSlicesEqual(
  a: MemoEditorEngineSlice,
  b: MemoEditorEngineSlice
): boolean {
  if (
    a.memoId !== b.memoId ||
    a.isRecording !== b.isRecording ||
    a.isPlaying !== b.isPlaying ||
    a.duration !== b.duration ||
    a.monitorMixActive !== b.monitorMixActive ||
    a.monitorMixReady !== b.monitorMixReady
  ) {
    return false;
  }

  if (a.isRecording || b.isRecording) {
    return a.recordingDuration === b.recordingDuration;
  }

  if (a.isPlaying && b.isPlaying) {
    return true;
  }

  return a.currentTime === b.currentTime;
}

const LIVE_PEAK_BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;

/**
 * Preview post-save latency trim during capture by dropping leading peaks.
 * Keeps startTime on the session (no pre-zero paint). Never returns an empty
 * peaks array — that triggers fake placeholder bars in normalizePeaksForBarCount.
 */
function previewLivePeaksForLatency(
  peaks: number[],
  leadSec: number
): { peaks: number[]; duration: number } | null {
  if (peaks.length === 0) {
    return null;
  }
  // Round to nearest bar so 0.17s (~2.72 bars) becomes 3 bars ≈ 0.1875s,
  // not floor→2 bars ≈ 0.125s which under-compensates vs post-save trim.
  const leadBars = Math.max(
    0,
    Math.round((Math.max(0, leadSec) * WAVEFORM_PIXELS_PER_SECOND) / LIVE_PEAK_BAR_STEP)
  );
  if (leadBars > 0 && peaks.length <= leadBars) {
    // Still inside the trimmed lead — no audible/post-trim content yet.
    return null;
  }
  const previewPeaks = leadBars > 0 ? peaks.slice(leadBars) : peaks;
  return {
    peaks: previewPeaks,
    duration: Math.max(
      0.01,
      (previewPeaks.length * LIVE_PEAK_BAR_STEP) / WAVEFORM_PIXELS_PER_SECOND
    ),
  };
}

function injectLiveRecordingPeaks(
  tracks: TrackData[],
  peaks: number[],
  leadSec: number
): TrackData[] {
  const preview = previewLivePeaksForLatency(peaks, leadSec);
  if (!preview) {
    // Still in latency lead — clear duration so WaveformView cannot synthesize
    // fake bars from the shell's 0.01s placeholder + undefined peaks.
    return tracks.map((track) => {
      if (track.id === '__recording__') {
        return { ...track, peaks: undefined, duration: 0 };
      }
      if (track.liveRecording) {
        return {
          ...track,
          liveRecording: {
            ...track.liveRecording,
            peaks: undefined,
            duration: 0,
          },
        };
      }
      return track;
    });
  }
  return tracks.map((track) => {
    if (track.id === '__recording__') {
      return { ...track, peaks: preview.peaks, duration: preview.duration };
    }
    if (track.liveRecording) {
      return {
        ...track,
        liveRecording: {
          ...track.liveRecording,
          peaks: preview.peaks,
          duration: preview.duration,
        },
      };
    }
    return track;
  });
}

type LiveRecordingWaveformProps = {
  isRecording: boolean;
  /** Matching post-save wake(+cue) trim, for live grid alignment. */
  latencyLeadSec?: number;
  tracks: TrackData[];
} & Omit<ComponentProps<typeof WaveformView>, 'tracks'>;
/** Subscribes only to live peaks so MemoEditor shell can ignore peak identity. */
function LiveRecordingWaveform({
  isRecording,
  latencyLeadSec = 0,
  tracks,
  ...waveformProps
}: LiveRecordingWaveformProps) {
  const recordingPeaks = useAudioEngineSelector((state) => state.recordingPeaks);
  const tracksWithPeaks = useMemo(() => {
    if (!isRecording) {
      return tracks;
    }
    return injectLiveRecordingPeaks(tracks, recordingPeaks, latencyLeadSec);
  }, [isRecording, latencyLeadSec, recordingPeaks, tracks]);

  return <WaveformView {...waveformProps} isRecording={isRecording} tracks={tracksWithPeaks} />;
}

function MemoEditorTimeLabel({
  memoId,
  pendingRecordingLayout,
  recordingStartTimeRef,
  style,
}: {
  memoId: string | undefined;
  pendingRecordingLayout: boolean;
  recordingStartTimeRef: MutableRefObject<number>;
  style: StyleProp<TextStyle>;
}) {
  const label = useAudioEngineSelector((state) => {
    if (pendingRecordingLayout) {
      if (state.isRecording) {
        return formatDurationWithTenths(
          recordingStartTimeRef.current + state.recordingDuration
        );
      }
      return formatDurationWithTenths(recordingStartTimeRef.current);
    }
    const isActive = memoId != null && state.memoId === memoId;
    return formatDurationWithTenths(isActive ? state.currentTime : 0);
  });

  return <Text style={style}>{label}</Text>;
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

const EDIT_DRAFT_IDLE_AUTOSAVE_MS = 3000;

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
  /** iPad split view: whether the recordings sidebar is hidden. */
  sidebarCollapsed?: boolean;
  /** iPad split view: toggle sidebar visibility. */
  onToggleSidebar?: () => void;
};

export function MemoEditor({
  memoId: id,
  autoRecord = false,
  presentation = 'sheet',
  backTitle,
  onDismiss,
  onMemoIdChange,
  onAutoRecordConsumed,
  sidebarCollapsed = false,
  onToggleSidebar,
}: MemoEditorProps) {
  const colors = useVoiceMemosColors();
  const styles = useMemoEditorStyles(colors);
  const isPane = presentation === 'pane';
  const record = autoRecord ? '1' : undefined;
  const navigation = useNavigation();
  const engine = useAudioEngine();
  const engineState = useAudioEngineSelector(
    selectMemoEditorEngine,
    areMemoEditorEngineSlicesEqual
  );
  const autoRecordStarted = useRef(false);
  const beginRecordingInFlight = useRef(false);
  const pendingLocationNamingRef = useRef(false);
  const recordingStartTime = useRef(0);
  const liveRecordingSnapshot = useRef<{
    startTime: number;
    duration: number;
    peaks: number[];
    color: string | null;
  } | null>(null);
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
  const [recordingArmed, setRecordingArmed] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<EditorTool | null>(null);
  const [savingTrim, setSavingTrim] = useState(false);
  const [colorPickerLayerId, setColorPickerLayerId] = useState<string | null>(null);
  const [trackMenuLayerId, setTrackMenuLayerId] = useState<string | null>(null);
  const [trackMenuFormatPicker, setTrackMenuFormatPicker] = useState(false);
  const [trackMenuMergePicker, setTrackMenuMergePicker] = useState(false);
  const [memoMergePickerVisible, setMemoMergePickerVisible] = useState(false);
  const [trackMenuRename, setTrackMenuRename] = useState<{
    layerId: string;
    label: string;
  } | null>(null);
  const [recordingRenameVisible, setRecordingRenameVisible] = useState(false);
  const [metronomeSettingsVisible, setMetronomeSettingsVisible] = useState(false);
  const [headphonesConnected, setHeadphonesConnected] = useState(false);
  const [loopSettingsVisible, setLoopSettingsVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [precountVisible, setPrecountVisible] = useState(false);
  const [precountNumber, setPrecountNumber] = useState<number | null>(null);
  const [precountPreparing, setPrecountPreparing] = useState(false);
  const precountPreparingRef = useRef(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const isStoppingRecordingRef = useRef(false);
  const lastLayoutHeightRef = useRef<number | null>(null);
  const settleRafRef = useRef<number | null>(null);
  const stackModeRef = useRef(false);
  const replaceModeRef = useRef(false);
  const pendingRecordModeRef = useRef<'stack' | 'replace' | null>(null);
  const activeLayerIdRef = useRef<string | null>(null);
  const isSavingRecordingOnExit = useRef(false);
  const pendingRecordingColor = useRef<string | null>(null);
  const monitorMixRef = useRef(false);
  const editDraftRef = useRef<EditDraftSnapshot | null>(null);
  const draftGenerationRef = useRef(0);
  const editDraftIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGestureActiveRef = useRef(false);
  const confirmEditDraftRef = useRef<() => Promise<void>>(async () => {});
  const precountCancelledRef = useRef(false);
  const precountDismissResolveRef = useRef<(() => void) | null>(null);
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

      // Compute from memoRef — React 19 may defer setState updaters, so side effects
      // must not depend on the updater running synchronously.
      const prev = memoRef.current;
      if (!prev) {
        return;
      }

      if (isDraftTrimUpdate && !isDraftGenerationCurrent(draftGeneration)) {
        return;
      }

      const layer = prev.layers.find((entry) => entry.id === layerId);
      if (!layer) {
        return;
      }

      const nextEffects = mergeLayerEffects(getLayerEffects(layer), partial, layer.duration);
      const trimInChanged = partial.trimIn !== undefined;
      const timelineDelta = trimInChanged
        ? getEarliestTrimInTimelineDelta(layer, prev.layers, nextEffects.trimIn)
        : 0;
      const shiftedLayers = applyTimelineDeltaToLayers(prev.layers, timelineDelta);
      const nextLayers = shiftedLayers.map((entry) =>
        entry.id === layerId ? { ...entry, effects: nextEffects } : entry
      );
      const layerStartTimes =
        timelineDelta !== 0
          ? Object.fromEntries(nextLayers.map((entry) => [entry.id, entry.startTime]))
          : undefined;
      const memoId = prev.id;
      const nextMemo = { ...prev, layers: nextLayers };

      memoRef.current = nextMemo;
      setMemo(nextMemo);

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
        void updateLayerEffects(memoId, layerId, {
          trimIn: nextEffects.trimIn,
          trimOut: nextEffects.trimOut,
          volumeDb: nextEffects.volumeDb,
          muted: nextEffects.muted,
          solo: nextEffects.solo,
          reverb: nextEffects.reverb,
          delay: nextEffects.delay,
          eq: nextEffects.eq,
        });
        if (layerStartTimes) {
          void updateLayerStartTimes(memoId, layerStartTimes);
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

  const clearEditDraftIdleTimer = useCallback(() => {
    if (editDraftIdleTimerRef.current) {
      clearTimeout(editDraftIdleTimerRef.current);
      editDraftIdleTimerRef.current = null;
    }
  }, []);

  const scheduleEditDraftIdleAutosave = useCallback(() => {
    clearEditDraftIdleTimer();
    if (!editDraftRef.current || editGestureActiveRef.current) {
      return;
    }
    editDraftIdleTimerRef.current = setTimeout(() => {
      editDraftIdleTimerRef.current = null;
      if (!editDraftRef.current || editGestureActiveRef.current) {
        return;
      }
      void confirmEditDraftRef.current();
    }, EDIT_DRAFT_IDLE_AUTOSAVE_MS);
  }, [clearEditDraftIdleTimer]);

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
      editGestureActiveRef.current = false;
      setActiveEditor(tool);
      scheduleEditDraftIdleAutosave();
    },
    [scheduleEditDraftIdleAutosave]
  );

  const cancelEditDraft = useCallback(async (): Promise<void> => {
    const snapshot = editDraftRef.current;
    if (!snapshot) {
      return;
    }

    draftGenerationRef.current += 1;
    clearEditDraftIdleTimer();
    clearDraftPersistTimers();
    editDraftRef.current = null;
    editGestureActiveRef.current = false;
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
  }, [clearDraftPersistTimers, clearEditDraftIdleTimer, engine]);

  const confirmEditDraft = useCallback(async (): Promise<void> => {
    const snapshot = editDraftRef.current;
    const current = memoRef.current;
    if (!snapshot || !current) {
      draftGenerationRef.current += 1;
      clearEditDraftIdleTimer();
      editDraftRef.current = null;
      editGestureActiveRef.current = false;
      setActiveEditor(null);
      return;
    }

    draftGenerationRef.current += 1;
    clearEditDraftIdleTimer();
    clearDraftPersistTimers();
    editDraftRef.current = null;
    editGestureActiveRef.current = false;
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
  }, [activeLayerId, clearDraftPersistTimers, clearEditDraftIdleTimer]);

  confirmEditDraftRef.current = confirmEditDraft;

  const handleEditGestureActive = useCallback(
    (active: boolean) => {
      editGestureActiveRef.current = active;
      if (active) {
        clearEditDraftIdleTimer();
        return;
      }
      scheduleEditDraftIdleAutosave();
    },
    [clearEditDraftIdleTimer, scheduleEditDraftIdleAutosave]
  );

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
      scheduleEditDraftIdleAutosave();
    },
    [handleEffectsChange, scheduleEditDraftIdleAutosave]
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
        scheduleEditDraftIdleAutosave();
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
    [activeLayerId, engine, isDraftGenerationCurrent, scheduleEditDraftIdleAutosave]
  );

  const handleLoopChange = useCallback(
    (loopStart: number, loopEnd: number, loopEnabled: boolean, loopSnapToGrid?: boolean) => {
      if (!memo) {
        return;
      }
      const nextSnap =
        loopSnapToGrid !== undefined ? loopSnapToGrid : memo.loopSnapToGrid;
      setMemo({ ...memo, loopStart, loopEnd, loopEnabled, loopSnapToGrid: nextSnap });
      engine.setLoopRegion(loopStart, loopEnd, loopEnabled);

      if (persistLoopTimeout.current) {
        clearTimeout(persistLoopTimeout.current);
      }
      persistLoopTimeout.current = setTimeout(() => {
        void updateLoopRegion(memo.id, loopStart, loopEnd, loopEnabled, nextSnap);
      }, 300);
    },
    [engine, memo]
  );

  const handleLoopSettingsChange = useCallback(
    (
      partial: Partial<{
        loopStart: number;
        loopEnd: number;
        loopEnabled: boolean;
        loopSnapToGrid: boolean;
      }>
    ) => {
      if (!memo) {
        return;
      }
      const loopStart = partial.loopStart ?? memo.loopStart ?? 0;
      const loopEnd = partial.loopEnd ?? memo.loopEnd ?? 0;
      const loopEnabled = partial.loopEnabled ?? memo.loopEnabled ?? false;
      const loopSnapToGrid =
        partial.loopSnapToGrid !== undefined
          ? partial.loopSnapToGrid
          : memo.loopSnapToGrid !== false;
      handleLoopChange(loopStart, loopEnd, loopEnabled, loopSnapToGrid);
    },
    [handleLoopChange, memo]
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

  const handleMetronomeCycle = useCallback(() => {
    if (!memo) {
      return;
    }
    void (async () => {
      const headphonesConnected = await isHeadphonesConnected();
      handleMetronomeChange(
        nextMetronomeMode(getMemoMetronomeSettings(memo), { headphonesConnected })
      );
    })();
  }, [handleMetronomeChange, memo]);

  const handlePrecountCycle = useCallback(() => {
    if (!memo) {
      return;
    }
    const next = nextPrecountMode(getMemoPrecountMode(memo));
    setMemo({ ...memo, precount: next });
    void updatePrecountMode(memo.id, next);
  }, [memo]);

  const clearPrecountOverlay = useCallback(() => {
    precountPreparingRef.current = false;
    setPrecountVisible(false);
    setPrecountNumber(null);
    setPrecountPreparing(false);
  }, []);

  /** Show preparing Modal and wait one frame so the spinner paints before warmup. */
  const showPreparingOverlay = useCallback(async () => {
    precountCancelledRef.current = false;
    precountPreparingRef.current = true;
    setPrecountNumber(null);
    setPrecountPreparing(true);
    setPrecountVisible(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, []);

  const handlePrecountModalDismiss = useCallback(() => {
    const resolve = precountDismissResolveRef.current;
    precountDismissResolveRef.current = null;
    resolve?.();
  }, []);

  /** Hide precount Modal and wait until native dismiss finishes (timeout fallback). */
  const dismissPrecountAndWait = useCallback(async () => {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        precountDismissResolveRef.current = null;
        resolve();
      };
      precountDismissResolveRef.current = finish;
      clearPrecountOverlay();
      // Android may not fire Modal onDismiss; never block arm forever.
      setTimeout(finish, 80);
    });
  }, [clearPrecountOverlay]);

  const handlePrecountCancel = useCallback(() => {
    precountCancelledRef.current = true;
    engine.abortRecordingStartCommit();
    // Warmup can take seconds on long layers — hide preparing UI immediately.
    if (precountPreparingRef.current) {
      clearPrecountOverlay();
    }
  }, [clearPrecountOverlay, engine]);

  const runPrecount = useCallback(
    async (
      mode: Exclude<PrecountMode, 'off'>,
      bpm: number
    ): Promise<{ completed: false } | { completed: true; nextBeatDeadlineMs: number }> => {
      precountCancelledRef.current = false;
      precountPreparingRef.current = false;
      setPrecountPreparing(false);
      setPrecountNumber(null);
      setPrecountVisible(true);
      const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
      const intervalMs = getQuarterIntervalSec(safeBpm) * 1000;

      const waitUntil = async (deadlineMs: number): Promise<boolean> => {
        while (Date.now() < deadlineMs) {
          if (precountCancelledRef.current) {
            return false;
          }
          const remaining = deadlineMs - Date.now();
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(40, Math.max(0, remaining)))
          );
        }
        return !precountCancelledRef.current;
      };

      // Caller must finalizeRecordingWarmup first so clicks use the recording context.
      if (mode === 'sound') {
        try {
          await engine.primeMetronomeOutput();
        } catch {
          // Best-effort; clicks may still fail later.
        }
      }

      // Let the modal mount before the first numeral so mount cost is outside beat 4.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (precountCancelledRef.current) {
        await dismissPrecountAndWait();
        return { completed: false };
      }

      const startMs = Date.now();

      // Beats "4" → "1" — equal timing; number + click in the same turn.
      for (let i = 0; i < 4; i++) {
        if (precountCancelledRef.current) {
          await dismissPrecountAndWait();
          return { completed: false };
        }
        const n = 4 - i;
        setPrecountNumber(n);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (mode === 'sound') {
          void engine.playMetronomeClick({ accent: n === 4 }).catch(() => {
            // Click is best-effort during precount.
          });
        }
        const ok = await waitUntil(startMs + (i + 1) * intervalMs);
        if (!ok) {
          await dismissPrecountAndWait();
          return { completed: false };
        }
      }

      // Dismiss Modal before commit — arming monitor mix while it is still up
      // freezes the UI at "1". Wait for onDismiss (not rAF).
      const beat1Deadline = startMs + 4 * intervalMs;
      await dismissPrecountAndWait();
      return {
        completed: true,
        nextBeatDeadlineMs: Math.max(beat1Deadline, Date.now()),
      };
    },
    [dismissPrecountAndWait, engine]
  );

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

  const performMergeLayers = useCallback(
    async (layerIds: string[], survivorId?: string) => {
      const current = memoRef.current;
      if (!current || engineState.isRecording || isExporting) {
        return;
      }

      try {
        await cancelEditDraft();
        flushEffectsPersist();
        flushStartTimePersist();
        const latest = memoRef.current;
        if (!latest) {
          return;
        }

        setIsExporting(true);
        if (engineState.isPlaying) {
          engine.pause();
        }

        const seekTime = Math.min(engine.getPlaybackTime(), latest.duration);
        const updated = await mergeLayers(latest.id, layerIds, survivorId);
        const nextActiveId =
          survivorId && updated.layers.some((layer) => layer.id === survivorId)
            ? survivorId
            : (getPlayableLayers(updated)[0]?.id ?? updated.layers[0]?.id ?? null);
        memoRef.current = updated;
        setMemo(updated);
        setActiveLayerId(nextActiveId);
        setActiveEditor(null);
        await loadMemoIntoEngine(engine, updated, seekTime);
      } catch (error) {
        Alert.alert(
          'Merge failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      } finally {
        setIsExporting(false);
      }
    },
    [
      cancelEditDraft,
      engine,
      engineState.isPlaying,
      engineState.isRecording,
      flushEffectsPersist,
      flushStartTimePersist,
      isExporting,
    ]
  );

  const confirmMergeLayers = useCallback(
    (layerIds: string[], survivorId?: string) => {
      Alert.alert(
        'Merge Layers',
        'Selected tracks will be combined into one. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Merge',
            style: 'destructive',
            onPress: () => {
              void performMergeLayers(layerIds, survivorId);
            },
          },
        ]
      );
    },
    [performMergeLayers]
  );

  const handleMergeAllLayers = useCallback(() => {
    if (!memo || !canMergeLayers(memo.layers) || engineState.isRecording) {
      return;
    }
    setTrackMenuLayerId(null);
    setTrackMenuFormatPicker(false);
    setTrackMenuMergePicker(false);
    setTrackMenuRename(null);
    setMemoMergePickerVisible(true);
  }, [engineState.isRecording, memo]);

  const getTrackMenuActions = useCallback(
    (layerId: string): IconActionSheetItem[] | undefined => {
      if (!memo || layerId === '__recording__' || layerId === 'empty') {
        return undefined;
      }

      const layer = memo.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.duration <= 0) {
        return undefined;
      }

      const effects = getLayerEffects(layer);
      const playableCount = getPlayableLayers(memo).length;
      const canDelete = playableCount > 1;
      const actions: IconActionSheetItem[] = [
        { id: 'export', title: 'Export', systemImage: 'square.and.arrow.up' },
        { id: 'rename', title: 'Rename Track', systemImage: 'pencil' },
        { id: 'changeColor', title: 'Change Color', systemImage: 'paintpalette' },
        {
          id: 'mute',
          title: effects.muted ? 'Unmute' : 'Mute',
          systemImage: effects.muted ? 'speaker.slash' : 'speaker.wave.2',
        },
        {
          id: 'solo',
          title: effects.solo ? 'Unsolo' : 'Solo',
          systemImage: 'headphones',
        },
      ];
      if (playableCount > 1) {
        actions.push({
          id: 'merge',
          title: 'Merge',
          systemImage: 'square.stack.3d.down.right',
        });
      }
      if (canDelete) {
        actions.push({
          id: 'delete',
          title: 'Delete Track',
          systemImage: 'trash',
          destructive: true,
        });
      }
      return actions;
    },
    [memo]
  );

  const handleTrackLongPress = useCallback(
    (layerId: string) => {
      if (!getTrackMenuActions(layerId)) {
        return;
      }

      const layer = memo?.layers.find((entry) => entry.id === layerId);
      const anySoloActive = memo
        ? hasAnySoloActive(memo.layers.map((entry) => getLayerEffects(entry)))
        : false;
      const canSelect =
        layer &&
        layerId !== activeLayerId &&
        !savingTrim &&
        isLayerSelectable(getLayerEffects(layer), anySoloActive);

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (canSelect) {
        void (async () => {
          await cancelEditDraft();
          flushEffectsPersist();
          flushStartTimePersist();
          setActiveLayerId(layerId);
          setActiveEditor(null);
          setTrackMenuRename(null);
          setTrackMenuFormatPicker(false);
          setTrackMenuMergePicker(false);
          setTrackMenuLayerId(layerId);
        })();
        return;
      }

      setTrackMenuRename(null);
      setTrackMenuFormatPicker(false);
      setTrackMenuMergePicker(false);
      setTrackMenuLayerId(layerId);
    },
    [
      activeLayerId,
      cancelEditDraft,
      flushEffectsPersist,
      flushStartTimePersist,
      getTrackMenuActions,
      memo,
      savingTrim,
    ]
  );

  const onTrackMenuAction = useCallback(
    (layerId: string, actionId: string) => {
      if (!memo || layerId === '__recording__' || layerId === 'empty') {
        return;
      }

      const layer = memo.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.duration <= 0) {
        return;
      }

      const effects = getLayerEffects(layer);
      const anySoloActive = hasAnySoloActive(
        memo.layers.map((entry) => getLayerEffects(entry))
      );

      const selectLayerIfNeeded = () => {
        if (layerId !== activeLayerId && isLayerSelectable(effects, anySoloActive)) {
          setActiveLayerId(layerId);
        }
      };

      switch (actionId) {
        case 'export':
          setTrackMenuMergePicker(false);
          setTrackMenuFormatPicker(true);
          break;
        case 'm4a':
        case 'wav':
          shareMemo(memo, {
            layerId,
            format: actionId,
            onExportStarted: () => setIsExporting(true),
            onExportFinished: () => setIsExporting(false),
          });
          break;
        case 'rename':
          selectLayerIfNeeded();
          setTrackMenuFormatPicker(false);
          setTrackMenuMergePicker(false);
          setTrackMenuRename({ layerId, label: layer.label });
          break;
        case 'changeColor':
          selectLayerIfNeeded();
          setColorPickerLayerId(layerId);
          break;
        case 'mute':
          applyLayerEffectsChange(layerId, { muted: !effects.muted });
          break;
        case 'solo':
          applyLayerEffectsChange(layerId, { solo: !effects.solo });
          break;
        case 'merge':
          if (canMergeLayers(memo.layers)) {
            setTrackMenuFormatPicker(false);
            setTrackMenuRename(null);
            setTrackMenuMergePicker(true);
          }
          break;
        case 'delete':
          if (getPlayableLayers(memo).length > 1) {
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
          break;
      }
    },
    [activeLayerId, applyLayerEffectsChange, handleDeleteTrack, memo]
  );

  const dismissTrackMenu = useCallback(() => {
    setTrackMenuLayerId(null);
    setTrackMenuFormatPicker(false);
    setTrackMenuMergePicker(false);
    setTrackMenuRename(null);
    setMemoMergePickerVisible(false);
  }, []);

  const handleTrackMergeConfirm = useCallback(
    (selectedIds: string[]) => {
      const anchorId = trackMenuLayerId;
      dismissTrackMenu();
      if (!anchorId || selectedIds.length === 0) {
        return;
      }
      confirmMergeLayers([anchorId, ...selectedIds], anchorId);
    },
    [confirmMergeLayers, dismissTrackMenu, trackMenuLayerId]
  );

  const handleMemoMergeConfirm = useCallback(
    (selectedIds: string[]) => {
      setMemoMergePickerVisible(false);
      if (selectedIds.length < 2) {
        return;
      }
      confirmMergeLayers(selectedIds);
    },
    [confirmMergeLayers]
  );

  const handleTrackRenameSave = useCallback(
    (value: string) => {
      if (!memo || !trackMenuRename) {
        dismissTrackMenu();
        return;
      }
      const trimmed = value.trim();
      const { layerId } = trackMenuRename;
      dismissTrackMenu();
      if (trimmed) {
        void updateLayerLabel(memo.id, layerId, trimmed).then(setMemo);
      }
    },
    [dismissTrackMenu, memo, trackMenuRename]
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

  const clearArmedRecordingUi = useCallback(() => {
    setRecordingArmed(false);
    setReplaceMode(false);
    setStackMode(false);
    pendingRecordModeRef.current = null;
    pendingRecordingColor.current = null;
    liveRecordingSnapshot.current = null;
  }, []);

  const loadMemo = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    await ensureRecordingBootstrapComplete(engine);
    const next = await getMemo(id);
    if (!next) {
      clearArmedRecordingUi();
      setMemo(null);
      setLoading(false);
      if (getLastDiscardedMemoId() === id || record === '1') {
        onDismiss();
      }
      return;
    }
    const loaded = hasRecording(next) ? await ensureWaveformPeaks(next) : next;
    setMemo(loaded);
    const liveSession = getSession();
    const isLiveRecordingForMemo =
      engine.getState().isRecording && liveSession?.memoId === id;

    if (isLiveRecordingForMemo && liveSession) {
      // Remount mid-take must not unload() — that clears isRecording without
      // stopping the native recorder and would lose the take on stop/save.
      recordingStartTime.current = liveSession.startTime;
      setRecordingArmed(true);
      setReplaceMode(liveSession.mode === 'replace');
      setStackMode(liveSession.mode === 'stack');
      pendingRecordingColor.current = liveSession.trackColor;
      if (liveSession.layerId) {
        setActiveLayerId(liveSession.layerId);
      } else {
        const anySoloActive = hasAnySoloActive(
          loaded.layers.map((entry) => getLayerEffects(entry))
        );
        const defaultLayer = loaded.layers.find(
          (layer) =>
            layer.duration > 0 &&
            isLayerSelectable(getLayerEffects(layer), anySoloActive)
        );
        setActiveLayerId(defaultLayer?.id ?? null);
      }
    } else {
      if (!engine.getState().isRecording && !beginRecordingInFlight.current) {
        clearArmedRecordingUi();
      }
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
        // unload() resets engine metronome to defaults; restore memo settings so
        // brand-new recordings still arm clicks when the UI shows metro on.
        engine.setMetronome(getMemoMetronomeSettings(loaded));
      }
    }
    setLoading(false);
  }, [clearArmedRecordingUi, engine, id, onDismiss, record]);

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
      setRecordingArmed(false);
      pendingRecordModeRef.current = null;
      monitorMixRef.current = false;
      pendingRecordingColor.current = null;
      liveRecordingSnapshot.current = null;
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
    precountCancelledRef.current = true;
  }, [id]);

  useEffect(() => {
    if (autoRecordStarted.current || !id) {
      return;
    }

    // Normal opens are loaded by loadMemo — do not refresh/setMemo here or the
    // effect will loop (memo dep / setMemo) and break layoutReady + playback.
    if (record !== '1') {
      autoRecordStarted.current = true;
      return;
    }

    void (async () => {
      await ensureRecordingBootstrapComplete(engine);
      if (autoRecordStarted.current) {
        return;
      }

      const refreshed = await getMemo(id);
      const hasProcessIntent = consumeAutoRecordIntent(id);
      const decision = decideAutoRecord({
        autoRecord: true,
        isRecording: engine.getState().isRecording,
        hasRecording: refreshed ? hasRecording(refreshed) : false,
        hasProcessIntent,
        sessionMemoId: getSession()?.memoId,
        memoId: id,
        memoMissing: !refreshed || getLastDiscardedMemoId() === id,
      });

      if (decision === 'skipDeletedMemo') {
        autoRecordStarted.current = true;
        onAutoRecordConsumed?.();
        clearArmedRecordingUi();
        onDismiss();
        return;
      }

      if (decision === 'skipNoProcessIntent') {
        // Restored ?record=1 after process death — do not re-arm Stop chrome.
        autoRecordStarted.current = true;
        onAutoRecordConsumed?.();
        clearArmedRecordingUi();
        return;
      }

      if (decision === 'skipNotRequested' || decision === 'skipHasAudio') {
        autoRecordStarted.current = true;
        onAutoRecordConsumed?.();
        return;
      }

      if (!refreshed) {
        autoRecordStarted.current = true;
        onAutoRecordConsumed?.();
        return;
      }

      if (decision === 'skipLiveRecording' || decision === 'skipOtherMemoSession') {
        autoRecordStarted.current = true;
        onAutoRecordConsumed?.();
        onDismiss();
        void deleteMemo(refreshed.id);
        return;
      }

      autoRecordStarted.current = true;
      setMemo(refreshed);
      pendingLocationNamingRef.current = true;
      onAutoRecordConsumed?.();

      if (beginRecordingInFlight.current || engine.getState().isRecording) {
        return;
      }
      beginRecordingInFlight.current = true;
      const memoId = refreshed.id;
      const memoTitle = refreshed.title;
      const precountMode = getMemoPrecountMode(refreshed);
      const bpm = getMemoMetronomeSettings(refreshed).bpm;
      let nextBeatDeadlineMs: number | undefined;
      try {
        await cancelEditDraft();
        setActiveEditor(null);

        recordingStartTime.current = 0;
        setRecordingArmed(true);
        beginSession({
          memoId,
          memoTitle,
          mode: 'new',
          layerId: null,
          startTime: 0,
          trackColor: null,
        });

        if (precountMode !== 'off') {
          await engine.prepareRecordingStart();
          await engine.finalizeRecordingWarmup();
          const precountResult = await runPrecount(precountMode, bpm);
          if (!precountResult.completed) {
            await engine.cancelPreparedRecording();
            clearPrecountOverlay();
            setRecordingArmed(false);
            clearSession();
            pendingLocationNamingRef.current = false;
            onDismiss();
            void deleteMemo(memoId);
            return;
          }
          if (engine.getState().isRecording) {
            clearPrecountOverlay();
            return;
          }
          nextBeatDeadlineMs = precountResult.nextBeatDeadlineMs;
        } else {
          await engine.prepareRecordingStart();
          await engine.finalizeRecordingWarmup();
        }

        await engine.commitRecordingStart({ nextBeatDeadlineMs });
        clearPrecountOverlay();
      } catch (error) {
        await engine.cancelPreparedRecording();
        clearPrecountOverlay();
        // Capture may already be live (e.g. Live Activity start threw after recorder.start).
        if (engine.getState().isRecording) {
          return;
        }
        setRecordingArmed(false);
        clearSession();
        if (error instanceof RecordingStartAbortedError || precountCancelledRef.current) {
          pendingLocationNamingRef.current = false;
          onDismiss();
          void deleteMemo(memoId);
          return;
        }
        Alert.alert(
          'Recording failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      } finally {
        beginRecordingInFlight.current = false;
      }
    })();
  }, [
    cancelEditDraft,
    clearArmedRecordingUi,
    clearPrecountOverlay,
    engine,
    id,
    onAutoRecordConsumed,
    onDismiss,
    record,
    runPrecount,
  ]);

  // Invariant: never leave armed/stack/replace chrome when capture is not live.
  useEffect(() => {
    if (engineState.isRecording) {
      return;
    }
    if (!recordingArmed && !stackMode && !replaceMode) {
      return;
    }
    const timer = setTimeout(() => {
      if (engine.getState().isRecording || beginRecordingInFlight.current) {
        return;
      }
      clearArmedRecordingUi();
    }, 0);
    return () => clearTimeout(timer);
  }, [
    clearArmedRecordingUi,
    engine,
    engineState.isRecording,
    recordingArmed,
    replaceMode,
    stackMode,
  ]);

  const stopAndSaveActiveRecording = useCallback(
    async (options?: { reloadEngine?: boolean }): Promise<boolean> => {
      const clearStopping = () => {
        isStoppingRecordingRef.current = false;
        setIsStoppingRecording(false);
      };

      const existingResult = await awaitSaveInFlight();
      if (existingResult) {
        clearStopping();
        return true;
      }

      if (!engine.getState().isRecording) {
        clearStopping();
        return true;
      }

      if (!memoRef.current) {
        clearStopping();
        return false;
      }

      isSavingRecordingOnExit.current = true;
      isStoppingRecordingRef.current = true;
      setIsStoppingRecording(true);
      try {
        const state = engine.getState();
        liveRecordingSnapshot.current = {
          startTime: recordingStartTime.current,
          duration: Math.max(state.recordingDuration, 0.01),
          peaks: state.recordingPeaks,
          color: pendingRecordingColor.current,
        };
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
        setRecordingArmed(false);
        pendingRecordModeRef.current = null;
        monitorMixRef.current = false;
        pendingRecordingColor.current = null;
        liveRecordingSnapshot.current = null;
        return true;
      } catch (error) {
        Alert.alert(
          'Could not save recording',
          error instanceof Error ? error.message : 'Unknown error'
        );
        return false;
      } finally {
        isSavingRecordingOnExit.current = false;
        clearStopping();
      }
    },
    [engine]
  );

  const cancelActiveRecording = useCallback(async () => {
    if (!engine.getState().isRecording) {
      await engine.cancelPreparedRecording();
      clearPrecountOverlay();
      setReplaceMode(false);
      setStackMode(false);
      setRecordingArmed(false);
      pendingRecordModeRef.current = null;
      pendingRecordingColor.current = null;
      liveRecordingSnapshot.current = null;
      return;
    }

    await engine.cancelRecording();
    clearPrecountOverlay();
    monitorMixRef.current = false;
    setReplaceMode(false);
    setStackMode(false);
    setRecordingArmed(false);
    pendingRecordModeRef.current = null;
    pendingRecordingColor.current = null;
    liveRecordingSnapshot.current = null;
  }, [clearPrecountOverlay, engine]);

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
      clearEditDraftIdleTimer();
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
  }, [clearEditDraftIdleTimer, engine, flushMetronomePersist, loadMemo, resetLayoutReady]);

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
    setRecordingRenameVisible(true);
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

  const renderHeaderBar = useCallback(
    () => (
      <View style={styles.headerBar}>
        {isPane ? (
          <View style={styles.headerActions}>
            {onToggleSidebar ? (
              <FloatingHeaderButton
                accessibilityLabel={
                  sidebarCollapsed ? 'Show sidebar' : 'Expand to full screen'
                }
                icon={
                  sidebarCollapsed
                    ? 'sidebar.left'
                    : 'arrow.up.left.and.arrow.down.right'
                }
                size="small"
                onPress={onToggleSidebar}
              />
            ) : null}
            {memo && hasRecording(memo) ? (
              <FloatingHeaderButton
                accessibilityLabel="Export"
                icon="square.and.arrow.up"
                size="small"
                onPress={handleShare}
              />
            ) : null}
            <FloatingHeaderButton
              accessibilityLabel="Rename"
              icon="pencil"
              size="small"
              onPress={handleRename}
            />
            <FloatingHeaderButton
              accessibilityLabel="Delete"
              icon="trash"
              size="small"
              tintColor={colors.recordRed}
              onPress={confirmDelete}
            />
          </View>
        ) : (
          <View style={styles.headerLeading}>
            <MemoOptionsMenu
              includeEditRecording={false}
              includeMergeLayers={memo ? canMergeLayers(memo.layers) : false}
              includeShare={memo ? hasRecording(memo) : false}
              onShare={handleShare}
              onRename={handleRename}
              onMergeLayers={handleMergeAllLayers}
              onDuplicate={() => void handleDuplicate()}
              onDelete={confirmDelete}>
              <FloatingHeaderIconFace
                accessibilityLabel="More options"
                icon="ellipsis"
                size="small"
              />
            </MemoOptionsMenu>
          </View>
        )}
        <Text
          numberOfLines={1}
          pointerEvents="none"
          style={[styles.headerTitle, isPane && styles.headerTitlePane]}>
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
      colors.recordRed,
      confirmDelete,
      engineState.isRecording,
      handleDone,
      handleDuplicate,
      handleMergeAllLayers,
      handleRename,
      handleShare,
      isPane,
      memo,
      onToggleSidebar,
      sidebarCollapsed,
      styles.doneButton,
      styles.doneButtonDisabled,
      styles.headerActions,
      styles.headerBar,
      styles.headerLeading,
      styles.headerTitle,
      styles.headerTitlePane,
    ],
  );

  const headerBar = useMemo(() => renderHeaderBar(), [renderHeaderBar]);

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

  const getPlaybackTime = useCallback(() => engine.getPlaybackTime(), [engine]);
  const getRecordingTime = useCallback(
    () => recordingStartTime.current + engine.getRecordingDuration(),
    [engine]
  );
  const handleWaveformSeek = useCallback(
    (time: number) => {
      if (!engine.getState().isRecording) {
        engine.seek(time);
      }
    },
    [engine]
  );

  const handlePlaybackScrubStart = useCallback(() => {
    engine.pause();
  }, [engine]);

  const handlePlaybackScrubEnd = useCallback(() => {
    void engine.play();
  }, [engine]);

  const handleStopRecording = () => {
    if (isStoppingRecordingRef.current || !engine.getState().isRecording) {
      return;
    }
    isStoppingRecordingRef.current = true;
    setIsStoppingRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

      if (!sidebarCollapsed && onToggleSidebar) {
        onToggleSidebar();
      }

      const useMonitorMix = needsMonitorMix(memo, mode);
      monitorMixRef.current = useMonitorMix;

      // Cancel trim/move drafts before arming so loadMemoIntoEngine cannot race
      // prepare/finalize/commit (stack monitor-mix warmup hang).
      await cancelEditDraft();
      setActiveEditor(null);

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
      pendingRecordModeRef.current = mode;
      setRecordingArmed(true);
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

      let nextBeatDeadlineMs: number | undefined;
      const precountMode = getMemoPrecountMode(memo);
      const abortArmedRecording = async () => {
        await engine.cancelPreparedRecording();
        clearPrecountOverlay();
        monitorMixRef.current = false;
        setReplaceMode(false);
        setStackMode(false);
        setRecordingArmed(false);
        pendingRecordModeRef.current = null;
        pendingRecordingColor.current = null;
        liveRecordingSnapshot.current = null;
        clearSession();
      };
      try {
        if (useMonitorMix) {
          await showPreparingOverlay();
          if (precountCancelledRef.current) {
            await abortArmedRecording();
            return;
          }
        }

        await engine.prepareRecordingStart({
          monitorMix: useMonitorMix,
        });
        if (precountCancelledRef.current) {
          await abortArmedRecording();
          return;
        }
        await engine.finalizeRecordingWarmup({ monitorMix: useMonitorMix });
        if (precountCancelledRef.current) {
          await abortArmedRecording();
          return;
        }

        if (precountMode !== 'off') {
          const bpm = getMemoMetronomeSettings(memo).bpm;
          const precountResult = await runPrecount(precountMode, bpm);
          if (!precountResult.completed) {
            await abortArmedRecording();
            return;
          }
          if (engine.getState().isRecording) {
            clearPrecountOverlay();
            return;
          }
          nextBeatDeadlineMs = precountResult.nextBeatDeadlineMs;
        } else if (useMonitorMix) {
          // Dismiss preparing Modal before arm — same rule as precount dismiss.
          await dismissPrecountAndWait();
        }

        await engine.commitRecordingStart({
          monitorMix: useMonitorMix,
          monitorStartTime: startTime,
          nextBeatDeadlineMs,
          silentLayerId: mode === 'replace' ? activeLayerId ?? undefined : undefined,
        });
        clearPrecountOverlay();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch (error) {
        await engine.cancelPreparedRecording();
        clearPrecountOverlay();
        // Capture may already be live (e.g. Live Activity start threw after recorder.start).
        if (engine.getState().isRecording) {
          return;
        }
        monitorMixRef.current = false;
        setReplaceMode(false);
        setStackMode(false);
        setRecordingArmed(false);
        pendingRecordModeRef.current = null;
        pendingRecordingColor.current = null;
        liveRecordingSnapshot.current = null;
        clearSession();
        if (error instanceof RecordingStartAbortedError || precountCancelledRef.current) {
          return;
        }
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
  const pendingRecordingLayout =
    recordingArmed || stackMode || replaceMode || isRecording;
  const currentTime = memo && isActiveMemo ? engineState.currentTime : 0;
  const recordingTimelineTime =
    recordingStartTime.current + engineState.recordingDuration;
  const pendingTimelineTime = recordingStartTime.current;
  const monitorMixPreparing =
    isRecording &&
    engineState.monitorMixActive &&
    !engineState.monitorMixReady;

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const state = engine.getState();
    liveRecordingSnapshot.current = {
      startTime: recordingStartTime.current,
      duration: Math.max(state.recordingDuration, 0.01),
      peaks: state.recordingPeaks,
      color: pendingRecordingColor.current,
    };
  }, [engine, isRecording, engineState.recordingDuration]);

  useEffect(() => {
    if (!pendingRecordingLayout || beginRecordingInFlight.current) {
      return;
    }
    void (async () => {
      await cancelEditDraft();
      setActiveEditor(null);
    })();
  }, [cancelEditDraft, pendingRecordingLayout]);

  useEffect(() => {
    if (isRecording) {
      setMetronomeSettingsVisible(false);
    }
  }, [isRecording]);

  useEffect(() => subscribeHeadphonesConnected(setHeadphonesConnected), []);

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

  const blockSheetGesture = isRecording;

  useLayoutEffect(() => {
    if (isPane) {
      return;
    }
    navigation.setOptions({ gestureEnabled: !blockSheetGesture });
  }, [navigation, blockSheetGesture, isPane]);

  const waveformDuration = pendingRecordingLayout
    ? Math.max(
        duration,
        isRecording
          ? recordingTimelineTime
          : liveRecordingSnapshot.current
            ? liveRecordingSnapshot.current.startTime +
              liveRecordingSnapshot.current.duration
            : pendingTimelineTime,
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
  /** Match post-save `wasSoftwareMonitoredCue` (monitor mix and/or metro clicks). */
  const liveLatencyLeadSec = useMemo(
    () =>
      getRecordingReplacementSkipSeconds(
        engineState.monitorMixActive || metronomeSettings.enabled
      ),
    [engineState.monitorMixActive, metronomeSettings.enabled]
  );
  const precountMode = useMemo(
    () => (memo ? getMemoPrecountMode(memo) : 'off'),
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
            volumeDb: effects.volumeDb,
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
            volumeDb: effects.volumeDb,
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
          volumeDb: effects.volumeDb,
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
      const snapshot = liveRecordingSnapshot.current;
      const isStackLayout = stackMode || pendingRecordModeRef.current === 'stack';
      const isReplaceLayout = replaceMode || pendingRecordModeRef.current === 'replace';
      let recordingDuration: number;
      let recordingPeaks: number[] | undefined;
      let recordingColor: string | undefined;

      if (isRecording) {
        // Placeholder; LiveRecordingWaveform injects live duration + peaks.
        recordingDuration = 0.01;
        recordingPeaks = undefined;
        recordingColor = isStackLayout
          ? (pendingRecordingColor.current ?? undefined)
          : resolveTrackColor(memo.layers[0]?.color);
      } else if (snapshot) {
        recordingDuration = Math.max(snapshot.duration, 0.01);
        recordingPeaks = snapshot.peaks.length > 0 ? snapshot.peaks : undefined;
        recordingColor = isStackLayout
          ? (snapshot.color ?? undefined)
          : resolveTrackColor(memo.layers[0]?.color);
      } else {
        // Armed / precount — no audio yet. duration 0 avoids fake placeholder bars.
        recordingDuration = 0;
        recordingPeaks = undefined;
        recordingColor = isStackLayout
          ? (pendingRecordingColor.current ?? undefined)
          : resolveTrackColor(memo.layers[0]?.color);
      }

      const sessionStart =
        isReplaceLayout || isStackLayout ? recordingStartTime.current : 0;

      const recordingTrack: TrackData = {
        id: '__recording__',
        peaks: recordingPeaks,
        startTime: sessionStart,
        duration: recordingDuration,
        isActive: true,
        color: recordingColor,
      };

      if (isStackLayout) {
        tracks = [recordingTrack, ...inactivePlayableTracks];
      } else if (isReplaceLayout && activeLayerId) {
        const replaceStart = recordingStartTime.current;
        const showLiveRecording = isRecording || snapshot != null;
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
            ...(showLiveRecording
              ? {
                  liveRecording: {
                    peaks: recordingPeaks,
                    startTime: sessionStart,
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
  const trackMenuActions = trackMenuLayerId
    ? getTrackMenuActions(trackMenuLayerId) ?? []
    : [];
  const trackMenuMergeOptions = useMemo((): IconActionSheetItem[] => {
    if (!memo || !trackMenuLayerId) {
      return [];
    }
    return getMergePartnerLayers(memo.layers, trackMenuLayerId).map((layer) => ({
      id: layer.id,
      title: layer.label,
    }));
  }, [memo, trackMenuLayerId]);
  const memoMergeOptions = useMemo((): IconActionSheetItem[] => {
    if (!memo) {
      return [];
    }
    return getPlayableLayersInTimelineOrder(memo.layers).map((layer) => ({
      id: layer.id,
      title: layer.label,
    }));
  }, [memo]);
  const showEditorContent = Boolean(memo && !loading);

  const timelineSnapIntervalSec = useMemo(() => {
    if (!metronomeSettings.showGrid) {
      return null;
    }
    return getClickIntervalSec(metronomeSettings);
  }, [metronomeSettings]);

  const trimOverlay = useMemo(() => {
    if (activeEditor !== 'trim' || savingTrim || !activeLayer || !activeLayerEffects) {
      return undefined;
    }
    return {
      layerId: activeLayer.id,
      trimIn: activeLayerEffects.trimIn,
      trimOut: activeLayerEffects.trimOut,
      onChange: handleTrimChange,
      snapIntervalSec: timelineSnapIntervalSec,
    };
  }, [
    activeEditor,
    activeLayer,
    activeLayerEffects,
    handleTrimChange,
    savingTrim,
    timelineSnapIntervalSec,
  ]);

  const moveOverlay = useMemo(() => {
    if (activeEditor !== 'move' || !activeLayer || !activeLayerEffects) {
      return undefined;
    }
    return {
      layerId: activeLayer.id,
      startTime: activeLayer.startTime,
      trimIn: activeLayerEffects.trimIn,
      onChange: handleLayerStartTimeChange,
      snapIntervalSec: timelineSnapIntervalSec,
    };
  }, [
    activeEditor,
    activeLayer,
    activeLayerEffects,
    handleLayerStartTimeChange,
    timelineSnapIntervalSec,
  ]);

  const loopOverlay = useMemo(() => {
    if (!memo || waveformDuration <= 0) {
      return undefined;
    }
    const snapEnabled = memo.loopSnapToGrid !== false;
    return {
      loopStart: memo.loopStart ?? 0,
      loopEnd: memo.loopEnd ?? 0,
      loopEnabled: memo.loopEnabled ?? false,
      duration: waveformDuration,
      onChange: handleLoopChange,
      onOpenSettings: () => setLoopSettingsVisible(true),
      holdExpanded: loopSettingsVisible,
      snapIntervalSec: snapEnabled ? timelineSnapIntervalSec : null,
    };
  }, [
    handleLoopChange,
    loopSettingsVisible,
    memo,
    timelineSnapIntervalSec,
    waveformDuration,
  ]);

  const loopSettingsValues = useMemo(() => {
    if (!memo) {
      return null;
    }
    return {
      loopStart: memo.loopStart ?? 0,
      loopEnd: memo.loopEnd ?? 0,
      loopEnabled: memo.loopEnabled ?? false,
      loopSnapToGrid: memo.loopSnapToGrid !== false,
      duration: waveformDuration,
    };
  }, [memo, waveformDuration]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      {isPane ? <View style={styles.paneHeader}>{headerBar}</View> : null}
      <View onLayout={handleContentLayout} style={styles.content}>
        <View style={styles.tracksArea}>
          {showEditorContent ? (
            <LiveRecordingWaveform
              currentTime={waveformCurrentTime}
              duration={waveformDuration}
              getPlaybackTime={getPlaybackTime}
              getRecordingTime={getRecordingTime}
              isPlaying={engineState.isPlaying && !monitorMixPreparing}
              isRecording={isRecording}
              latencyLeadSec={liveLatencyLeadSec}
              recordingLayoutActive={pendingRecordingLayout}
              tracks={waveformTracks}
              trimOverlay={trimOverlay}
              moveOverlay={moveOverlay}
              loopOverlay={loopOverlay}
              metronome={metronomeSettings}
              onSeek={handleWaveformSeek}
              onPlaybackScrubStart={handlePlaybackScrubStart}
              onPlaybackScrubEnd={handlePlaybackScrubEnd}
              onTrackPress={handleTrackPress}
              onTrackDeselect={handleTrackDeselect}
              onTrackLongPress={handleTrackLongPress}
              onEditGestureActive={handleEditGestureActive}
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
                    disabled={isRecording}
                    headphonesConnected={headphonesConnected}
                    settings={metronomeSettings}
                    onCycle={handleMetronomeCycle}
                    onOpenSettings={() => setMetronomeSettingsVisible(true)}
                  />
                </View>
                <MemoEditorTimeLabel
                  memoId={memo?.id}
                  pendingRecordingLayout={pendingRecordingLayout}
                  recordingStartTimeRef={recordingStartTime}
                  style={styles.largeTime}
                />
                <View style={styles.timeDisplaySideEnd}>
                  <PrecountButton
                    disabled={isRecording}
                    mode={precountMode}
                    onCycle={handlePrecountCycle}
                  />
                </View>
              </View>

              <PlaybackControls
                currentTime={currentTime}
                duration={duration}
                isPlaying={engineState.isPlaying}
                isRecording={isRecording}
                isStoppingRecording={isStoppingRecording}
                recordDisabled={!memo || !hasRecording(memo) || pendingRecordingLayout}
                showProgressBar={false}
                showTimeLabels={false}
                stopRecordingDisabled={!isRecording}
                onPlayPause={() => void handlePlayPause()}
                onRecordPress={showRecordOptions}
                onSkipBack={() => engine.skip(-15)}
                onSkipForward={() => engine.skip(15)}
                onStopRecording={handleStopRecording}
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
      {loopSettingsValues ? (
        <LoopSettingsSheet
          snapIntervalSec={
            loopSettingsValues.loopSnapToGrid ? timelineSnapIntervalSec : null
          }
          values={loopSettingsValues}
          visible={loopSettingsVisible}
          onChange={handleLoopSettingsChange}
          onClose={() => setLoopSettingsVisible(false)}
        />
      ) : null}
      <PrecountOverlay
        count={precountNumber}
        preparing={precountPreparing}
        visible={precountVisible}
        onCancel={handlePrecountCancel}
        onDismiss={handlePrecountModalDismiss}
      />
      <IconActionSheet
        actions={trackMenuActions}
        formatPicker={
          trackMenuFormatPicker ? { title: 'Choose format…' } : null
        }
        multiSelect={
          memoMergePickerVisible
            ? {
                title: 'Merge Layers',
                options: memoMergeOptions,
                confirmTitle: 'Merge',
                minSelection: 2,
              }
            : trackMenuMergePicker
              ? {
                  title: 'Merge with…',
                  options: trackMenuMergeOptions,
                  confirmTitle: 'Merge',
                }
              : null
        }
        rename={
          trackMenuRename
            ? { title: 'Rename Track', initialValue: trackMenuRename.label }
            : null
        }
        visible={trackMenuLayerId !== null || memoMergePickerVisible}
        onDismiss={dismissTrackMenu}
        onMultiSelectConfirm={
          memoMergePickerVisible ? handleMemoMergeConfirm : handleTrackMergeConfirm
        }
        onRenameSave={handleTrackRenameSave}
        onSelect={(actionId) => {
          if (trackMenuLayerId) {
            onTrackMenuAction(trackMenuLayerId, actionId);
          }
        }}
      />
      <NamePromptDialog
        initialValue={memo?.title ?? ''}
        title="Rename Recording"
        visible={recordingRenameVisible}
        onCancel={() => setRecordingRenameVisible(false)}
        onSave={(value) => {
          setRecordingRenameVisible(false);
          if (value.trim() && memo) {
            void updateTitle(memo.id, value.trim()).then(setMemo);
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
    </SafeAreaView>
  );
}

function useMemoEditorStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
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
          zIndex: 1,
        },
        doneButtonDisabled: {
          opacity: 0.4,
        },
        headerBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          paddingHorizontal: 8,
          position: 'relative',
        },
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          zIndex: 1,
        },
        headerLeading: {
          zIndex: 1,
        },
        headerTitle: {
          position: 'absolute',
          left: 0,
          right: 0,
          fontSize: 17,
          fontWeight: '500',
          color: colors.text,
          textAlign: 'center',
          // Clears ellipsis (32) + Done (32) + bar padding on iPhone.
          paddingHorizontal: 58,
          zIndex: 0,
        },
        headerTitlePane: {
          // Clears up to 4 small pane actions (32×4 + gaps) on the leading side.
          paddingHorizontal: 152,
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
          width: 40,
          alignItems: 'flex-start',
        },
        timeDisplaySideEnd: {
          width: 40,
          alignItems: 'flex-end',
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
    [colors]
  );
}
