import {
    AudioContext,
    AudioManager,
    AudioRecorder,
    decodeAudioData,
    FileDirectory,
    FileFormat,
    FilePreset,
    type AudioBuffer,
    type AudioBufferSourceNode,
    type GainNode,
} from 'react-native-audio-api';
import { AppState } from 'react-native';

import { File } from 'expo-file-system';

import {
    assertRecordingRouteOk,
    getActiveRouteSnapshot,
    logRouteSnapshot,
    pinBuiltInMicrophone,
} from '@/src/audio/audioInputRouting';
import {
    classifyCueOutputRoute,
    type CueOutputRoute,
} from '@/src/audio/recordingLatency';
import { schedulePathFades } from '@/src/audio/fadeCurve';
import {
    clearReverbIrCache,
    isDelayPathActive,
    isReverbPathActive,
    type LayerEffectPathNodes,
} from '@/src/audio/layerEffectChain';
import {
  buildLayerPlaybackPlans,
  filterPlaybackPlansBySilentLayer,
  getLayerEffectsForPlayback,
  partitionPlansByHorizon,
  playbackScheduleLeadSec,
  PLAYBACK_END_TOLERANCE,
  PLAYBACK_SCHEDULE_CHUNK_SEC,
  PLAYBACK_SCHEDULE_EXTEND_LEAD_SEC,
  resolvePlanAgainstBuffer,
} from '@/src/audio/playbackPlans';
import { hasAnySoloActive, isLayerAudible, mergeLayerEffects, type LayerEffects, type LayerEffectsChange } from '@/src/audio/layerEffects';
import {
  scheduleMetronomeClicks,
  playMetronomeClick as scheduleOneMetronomeClick,
  playSilentMetronomePrime,
  prewarmMetronomeClickBuffers,
  PRECOUNT_CLICK_LEAD_SEC,
} from '@/src/audio/metronome';
import { MemoMixGraph } from '@/src/audio/memoMixGraph';
import { accumulatePeaksFromSamples } from '@/src/audio/recordingWaveformPeaks';
import { appendAbsoluteRecordingPeaks } from '@/src/audio/recordingPeaksEmit';
import {
    peakToAbsoluteScale,
    shouldUseCapturedPeaks,
    WAVEFORM_BAR_GAP,
    WAVEFORM_BAR_WIDTH,
    WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import {
    normalizeRecordingFile,
    recordingNeedsNormalize,
    resampleMonoBufferFromRateAsync,
} from '@/src/audio/wavUtils';
import {
    awaitSaveInFlight,
    clearSession,
    getSession,
} from '@/src/recording/activeRecordingSession';
import {
    endMemoLiveActivity,
    ensurePlaybackLiveActivity,
    startRecordingLiveActivity,
} from '@/src/widgets/recordingLiveActivityController';
import {
    DEFAULT_METRONOME_SETTINGS,
    normalizeMetronomeSettings,
    type MetronomeSettings,
    type Memo,
} from '@/src/storage/types';
import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';
import {
  getResampledCacheKeysForPath,
  layersNeedingBufferInvalidation,
} from '@/src/audio/layerBufferCache';

type SessionMode = 'recording' | 'playback' | null;

const RECORDING_BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
const RECORDING_SAMPLE_RATE = 44100;
const PLAYBACK_SCHEDULE_LEAD = 0.01;
/**
 * Recording-only schedule lead. Kept small so clicks stay near the recorder
 * clock / grid; large enough to build the first metronome/monitor nodes.
 * Do not reuse PLAYBACK_SCHEDULE_LEAD here — playback scrub/resync stays separate.
 */
const RECORDING_SCHEDULE_LEAD = 0.015;
/** Let the precount "1" click finish before arming replaces metronome sources. */
const PRECOUNT_ONE_TAIL_MS = 40;
/** Wait after silent prime so Bluetooth A2DP can wake before beat 4. */
const PRECOUNT_SILENT_PRIME_SETTLE_MS = 100;
/** Start the recorder this close to the audio downbeat after metro is already armed. */
const RECORDING_RECORDER_WAKE_LEAD_SEC = 0.005;
/** How far ahead to schedule metronome clicks while recording without monitor mix. */
const METRONOME_SCHEDULE_CHUNK_SEC = 12;
const METRONOME_SCHEDULE_EXTEND_LEAD_SEC = 2;
/**
 * Cue (monitor mix + metronome) gain when stacking/replacing on speaker.
 * Quieter output reduces mic bleed into the new take (~−8 dB).
 */
const SPEAKER_MONITOR_MIX_GAIN = 0.4;
/** Ignore routeChange callbacks caused by our own setAudioSessionOptions. */
const ROUTE_CHANGE_IGNORE_MS = 400;

/** Thrown when precount cancel aborts commit during the downbeat wait. */
export class RecordingStartAbortedError extends Error {
  constructor() {
    super('Recording start aborted');
    this.name = 'RecordingStartAbortedError';
  }
}

function assertRecordingFilePresent(path: string): void {
  let exists = false;
  let size = 0;
  try {
    const file = new File(path);
    exists = file.exists;
    size = file.size ?? 0;
  } catch {
    exists = false;
    size = 0;
  }
  if (!exists || size <= 0) {
    throw new Error('Recording file was not written. Try recording again.');
  }
}
const PLAYBACK_UI_UPDATE_MS = 50;

/** Sample rates the iOS AAC encoder accepts reliably when opening a file for writing. */
const RECORDING_FILE_PRESET = {
  ...FilePreset.Medium,
  sampleRate: RECORDING_SAMPLE_RATE,
};

export type LoadedLayer = {
  id: string;
  path: string;
  startTime: number;
  duration: number;
  /** Absolute timeline end of looped footprint; see Layer.loopUntil. */
  loopUntil?: number;
  effects: LayerEffects;
};

type ActiveLayerPlayback = {
  layerId: string;
  hasDelay: boolean;
  hasReverb: boolean;
  drySources: AudioBufferSourceNode[];
  delaySources: AudioBufferSourceNode[];
  reverbSources: AudioBufferSourceNode[];
  /** Schedule params for hot-adding wet paths mid-playback. */
  buffer: AudioBuffer;
  bufferOffset: number;
  scheduleDelay: number;
  layerPlayLength: number;
  /** How much of `layerPlayLength` has been scheduled (tiled monitor mix). */
  scheduledLength: number;
  playbackEffects: LayerEffects;
};

type LayerPlaybackPlan = {
  layer: LoadedLayer;
  buffer: AudioBuffer;
  playbackEffects: LayerEffects;
  bufferOffset: number;
  delay: number;
  layerPlayLength: number;
};

export type RecordingCaptureResult = {
  path: string;
  duration: number;
  peaks: number[];
  wasMonitorMix: boolean;
  /** Monitor mix and/or metronome played from AudioContext during the take. */
  wasSoftwareMonitoredCue: boolean;
  /** Output route class at recording start — drives software-cue compensation. */
  cueOutputRoute: CueOutputRoute;
  recorderDuration: number;
  /** True when capture used our 44.1k WAV preset — safe to skip verify-decode. */
  usedWavFormat: boolean;
};

export type EngineState = {
  memoId: string | null;
  memoTitle: string | null;
  isRecording: boolean;
  isPlaying: boolean;
  monitorMixActive: boolean;
  monitorMixReady: boolean;
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  recordingDuration: number;
  recordingPeaks: number[];
  metronome: MetronomeSettings;
};

type Listener = (state: EngineState) => void;

const initialState: EngineState = {
  memoId: null,
  memoTitle: null,
  isRecording: false,
  isPlaying: false,
  monitorMixActive: false,
  monitorMixReady: false,
  currentTime: 0,
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: false,
  recordingDuration: 0,
  recordingPeaks: [],
  metronome: DEFAULT_METRONOME_SETTINGS,
};

export class MemoAudioEngine {
  private state: EngineState = { ...initialState };
  private listeners = new Set<Listener>();
  private context: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private loadedLayers: LoadedLayer[] = [];
  private layerBuffers = new Map<string, AudioBuffer>();
  /** Resampled playback buffers keyed by `${path}@${contextSampleRate}`. */
  private resampledLayerBuffers = new Map<string, AudioBuffer>();
  private playInFlight: Promise<void> | null = null;
  /** Request id that owns `playInFlight`; used so pause-cancelled plays are not coalesced. */
  private playInFlightRequestId = 0;
  private playRequestId = 0;
  private activeRecordingSampleRate: number | null = null;
  private recordingUsedWavFormat = false;
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private playbackRafId: number | null = null;
  private playbackEndTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private playbackSessionId = 0;
  private activePlaybackSessionId = 0;
  private playbackStartAt = 0;
  private playbackEndAt = 0;
  private playbackContextStartWhen = 0;
  /** Current playback rate applied to live sources (1 = normal). */
  private playbackRate = 1;
  /** AudioContext time of the last rate-clock anchor. */
  private playbackRateAnchorContextTime = 0;
  /** Timeline position at the last rate-clock anchor. */
  private playbackRateAnchorPosition = 0;
  private sessionMode: SessionMode = null;
  private lastOutputRouteKey = '';
  private recordingPeaksBuffer: number[] = [];
  private lastEmittedRecordingPeakCount = -1;
  private lastEmittedRecordingPeaks: number[] = [];
  private activeLayerPlaybacks: ActiveLayerPlayback[] = [];
  /** Resolved cycle segments waiting for the sliding schedule horizon. */
  private pendingLayerPlaybacks: LayerPlaybackPlan[] = [];
  /** Monitor-mix schedules dry-only; normal play includes wet paths. */
  private layerPlaybackDryOnly = false;
  /**
   * Timeline end of the last monitor-mix plan window that was generated.
   * Next windows are built in extendMonitorMixSchedule (avoids full loopUntil plan storms).
   */
  private monitorMixPlannedUntil = 0;
  private mixGraph = new MemoMixGraph();
  private metronomeSettings: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;
  private metronomeGain: GainNode | null = null;
  private metronomeGainContext: AudioContext | null = null;
  private metronomeSources: AudioBufferSourceNode[] = [];
  private metronomeOnlyActive = false;
  private metronomeScheduledUntil = 0;
  /** AudioContext time corresponding to `metronomeTimelineOrigin`. */
  private metronomeAudioOrigin = 0;
  /** Timeline time corresponding to `metronomeAudioOrigin`. */
  private metronomeTimelineOrigin = 0;
  /** False while Phase B warmup runs so precount clicks cannot rebuild a stale graph. */
  private allowPrecountClicks = true;
  private deferredPlaybackSetup = false;
  private pendingEngineReload: {
    memo: Memo;
    seekTime: number;
    invalidatePaths?: string[];
  } | null = null;
  private deferredSetupInFlight: Promise<void> | null = null;
  private recordingSessionPrewarmed = false;
  private stopCaptureInFlight = false;
  private recordingStartInFlight: Promise<void> | null = null;
  private recordingPrepareInFlight: Promise<void> | null = null;
  private recordingPrepared = false;
  private recordingWarmupFinalized = false;
  private preparedMonitorMix = false;
  /** Lower master cue gain while monitor-mixing without headphones. */
  private preparedDuckMonitorMix = false;
  /** Layer muted in monitor mix while replacing (other layers stay audible). */
  private monitorSilentLayerId: string | null = null;
  /** Set by abortRecordingStartCommit() to interrupt the precount downbeat wait. */
  private recordingStartAborted = false;
  /** Cue-output route captured at prepareRecordingRoute (defaults to wired). */
  private recordingCueOutputRoute: CueOutputRoute = 'wired';
  /** Resampled/ready buffers for monitor-mix atomic start (path → buffer). */
  private recordingPlaybackBuffers = new Map<string, AudioBuffer>();
  /** True between AVAudioSession interruption began/ended while a take is live. */
  private recordingInterrupted = false;
  /** True between playback interruption began and session heal on ended/foreground. */
  private playbackInterrupted = false;
  /** Ignore routeChange until this timestamp (self-caused CategoryChange). */
  private ignoreRouteChangeUntil = 0;
  private previewContext: AudioContext | null = null;
  private previewGain: GainNode | null = null;
  private previewSources: AudioBufferSourceNode[] = [];
  private previewActive = false;
  private previewSettings: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;
  private previewScheduledUntil = 0;
  private previewTimelineOrigin = 0;
  private previewAudioOrigin = 0;
  private previewStartMs = 0;
  private previewExtendTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    AudioManager.addSystemEventListener('routeChange', () => {
      void this.handleRouteChange();
    });
    AudioManager.addSystemEventListener('interruption', (event) => {
      void this.handleInterruption(event);
    });

    AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        // App Switcher / background: stop UI RAF; keep native audio scheduled.
        this.freezePlaybackUiForBackground();
        return;
      }

      void (async () => {
        if (this.state.isRecording) {
          return;
        }

        await awaitSaveInFlight();

        const deferredPending =
          this.deferredPlaybackSetup || this.pendingEngineReload !== null;
        if (deferredPending) {
          await this.finishDeferredPlaybackSetup();
          await this.healPlaybackSessionIfNeeded();
          return;
        }

        if (this.isHealthyPlayingSession()) {
          this.resumePlaybackUiFromBackground();
          return;
        }

        await this.healPlaybackSessionIfNeeded();
      })();
    });
  }

  private isHealthyPlayingSession(): boolean {
    return (
      this.state.isPlaying &&
      this.playbackContextStartWhen > 0 &&
      !this.playbackInterrupted &&
      this.context?.state !== 'suspended'
    );
  }

  private markIgnoreRouteChange(): void {
    this.ignoreRouteChangeUntil = Date.now() + ROUTE_CHANGE_IGNORE_MS;
  }

  private setAudioInterruptionObservation(enabled: boolean): void {
    // While observing, native skips auto onInterruptionEnd — JS owns recovery.
    AudioManager.observeAudioInterruptions(enabled);
  }

  private setRecordingInterruptionObservation(enabled: boolean): void {
    this.setAudioInterruptionObservation(enabled);
  }

  private setPlaybackInterruptionObservation(enabled: boolean): void {
    // Recording owns observation for the whole take.
    if (!enabled && this.state.isRecording) {
      return;
    }
    this.setAudioInterruptionObservation(enabled);
  }

  /** Pause playback for an AVAudioSession interruption; keep observing for `ended`. */
  private pausePlaybackForInterruption(): void {
    this.playRequestId += 1;
    const pausedAt =
      this.context && this.playbackContextStartWhen > 0
        ? this.getElapsedPlaybackTime(this.context)
        : this.state.currentTime;
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: pausedAt });
    void endMemoLiveActivity();
    this.sessionMode = null;
    this.playbackInterrupted = true;
  }

  private async healPlaybackAfterInterruption(): Promise<void> {
    this.playbackInterrupted = false;
    try {
      await this.forceConfigureForPlayback();
      if (!this.state.isRecording) {
        await this.ensureContext();
      }
    } catch (error) {
      this.sessionMode = null;
      if (__DEV__) {
        console.warn('[MemoAudioEngine] playback interruption heal failed', error);
      }
    } finally {
      if (!this.state.isRecording && !this.state.isPlaying) {
        this.setPlaybackInterruptionObservation(false);
      }
    }
  }

  /** Foreground recovery when interrupt left playback/session stale. Never auto-resumes. */
  private async healPlaybackSessionIfNeeded(): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    const hasValidPlaybackClock =
      this.state.isPlaying && this.playbackContextStartWhen > 0;
    const contextSuspended = this.context?.state === 'suspended';

    if (hasValidPlaybackClock && !this.playbackInterrupted && !contextSuspended) {
      return;
    }

    if (!this.playbackInterrupted && !this.state.isPlaying && !contextSuspended) {
      return;
    }

    if (this.state.isPlaying || this.playbackInterrupted) {
      this.playRequestId += 1;
      const pausedAt =
        this.context && this.playbackContextStartWhen > 0
          ? this.getElapsedPlaybackTime(this.context)
          : this.state.currentTime;
      this.invalidateAndStopSources();
      this.emit({ isPlaying: false, currentTime: pausedAt });
      void endMemoLiveActivity();
      this.sessionMode = null;
    }

    await this.healPlaybackAfterInterruption();
  }

  private async handleInterruption(event: {
    type: 'began' | 'ended';
    shouldResume: boolean;
  }): Promise<void> {
    if (this.state.isRecording) {
      if (this.stopCaptureInFlight) {
        return;
      }

      if (event.type === 'began') {
        this.recordingInterrupted = true;
        return;
      }

      // Interruption ended — always try to reclaim capture. System alerts (Live Activity
      // Allow) often set shouldResume=false even though the take should continue.
      this.recordingInterrupted = false;
      try {
        await this.configureForRecording();
        if (this.recorder?.isPaused()) {
          this.recorder.resume();
        } else if (this.recorder && !this.recorder.isRecording()) {
          this.recorder.resume();
        }
        this.refreshActiveRecordingSampleRate();
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[MemoAudioEngine] recording interruption resume failed; continuing',
            error
          );
        }
      }
      return;
    }

    // Playback / idle — never auto-resume (shouldResume is intentionally ignored).
    if (event.type === 'began') {
      if (
        this.state.isPlaying ||
        this.playbackContextStartWhen > 0 ||
        this.playInFlight
      ) {
        this.pausePlaybackForInterruption();
      } else {
        this.sessionMode = null;
        this.playbackInterrupted = true;
      }
      return;
    }

    if (!this.playbackInterrupted) {
      return;
    }

    await this.healPlaybackAfterInterruption();
  }

  private async handleRouteChange(): Promise<void> {
    if (Date.now() < this.ignoreRouteChangeUntil) {
      return;
    }

    if (this.state.isRecording) {
      if (this.stopCaptureInFlight || this.recordingInterrupted) {
        return;
      }

      // Unlock / Live Activity allow prompt cause route churn. Never re-pin the mic
      // or discard a live take — setPreferredInput mid-capture can kill the WAV.
      try {
        const routeSnapshot = await getActiveRouteSnapshot();
        logRouteSnapshot('recording-route-change', routeSnapshot);
        this.refreshActiveRecordingSampleRate();
      } catch (error) {
        if (__DEV__) {
          console.warn('[MemoAudioEngine] recording route snapshot failed; continuing', error);
        }
      }
      return;
    }

    // Armed for record (warmup / precount) — do not tear down the recording context.
    if (this.recordingPrepared || this.recordingWarmupFinalized) {
      await this.refreshOutputRouteKey();
      return;
    }

    let devices;
    try {
      devices = await AudioManager.getDevicesInfo();
    } catch {
      return;
    }

    const routeKey = (devices.currentOutputs ?? [])
      .map((device) => device.category)
      .join('|');
    if (routeKey === this.lastOutputRouteKey) {
      return;
    }
    this.lastOutputRouteKey = routeKey;

    const resumeTime = this.state.currentTime;
    const wasPlaying = this.state.isPlaying;
    await this.resetPlaybackGraph();
    await this.configureForPlayback();
    this.emit({ currentTime: resumeTime, isPlaying: false });
    if (wasPlaying) {
      await this.play();
    }
  }

  private async refreshOutputRouteKey(): Promise<void> {
    try {
      const devices = await AudioManager.getDevicesInfo();
      this.lastOutputRouteKey = (devices.currentOutputs ?? [])
        .map((device) => device.category)
        .join('|');
    } catch {
      this.lastOutputRouteKey = '';
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): EngineState {
    return this.state;
  }

  getPlaybackTime(): number {
    if (!this.context || this.playbackContextStartWhen <= 0) {
      return this.state.currentTime;
    }
    return this.getElapsedPlaybackTime(this.context);
  }

  getRecordingDuration(): number {
    return this.recorder?.getCurrentDuration() ?? this.state.recordingDuration;
  }

  async prewarmRecordingSession(): Promise<void> {
    if (this.recordingSessionPrewarmed || this.state.isRecording) {
      return;
    }

    const granted = await this.requestPermission();
    if (!granted) {
      return;
    }

    try {
      await this.configureForRecording();
      this.recordingSessionPrewarmed = true;
    } catch (error) {
      if (__DEV__) {
        console.warn('[MemoAudioEngine] prewarm recording session failed', error);
      }
    }
  }

  scheduleDeferredEngineReload(
    memo: Memo,
    seekTime: number,
    invalidatePaths?: string[]
  ): void {
    this.pendingEngineReload = {
      memo,
      seekTime,
      invalidatePaths:
        invalidatePaths && invalidatePaths.length > 0 ? invalidatePaths : undefined,
    };
  }

  async finishDeferredPlaybackSetup(): Promise<void> {
    if (this.deferredSetupInFlight) {
      return this.deferredSetupInFlight;
    }

    if (!this.deferredPlaybackSetup && !this.pendingEngineReload) {
      return;
    }

    const setupPromise = (async (): Promise<void> => {
      const pending = this.pendingEngineReload;
      this.pendingEngineReload = null;
      this.deferredPlaybackSetup = false;

      try {
        await this.resetPlaybackGraph();
        await this.configureForPlayback();
        if (pending) {
          if (pending.invalidatePaths) {
            for (const path of pending.invalidatePaths) {
              this.invalidateLayerBufferForPath(path);
            }
            this.resetRecordingWarmupCaches();
          }
          await loadMemoIntoEngine(this, pending.memo, pending.seekTime);
        }
      } catch (error) {
        this.sessionMode = null;
        if (__DEV__) {
          console.warn('[MemoAudioEngine] deferred playback setup failed', error);
        }
      }
    })();

    this.deferredSetupInFlight = setupPromise;
    try {
      await setupPromise;
    } finally {
      if (this.deferredSetupInFlight === setupPromise) {
        this.deferredSetupInFlight = null;
      }
    }
  }

  private isAppInBackground(): boolean {
    return AppState.currentState !== 'active';
  }

  private emit(partial: Partial<EngineState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private async applySessionMode(target: 'recording' | 'playback'): Promise<void> {
    if (this.sessionMode === target) {
      try {
        const activated = await AudioManager.setAudioSessionActivity(true);
        if (activated) {
          return;
        }
        this.sessionMode = null;
      } catch {
        this.sessionMode = null;
      }
    }

    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      // Session may already be inactive.
    }

    this.markIgnoreRouteChange();
    if (target === 'recording') {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
      });
    } else {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playback',
        iosMode: 'default',
        iosOptions: ['allowBluetoothA2DP'],
      });
    }

    this.sessionMode = target;

    try {
      const activated = await AudioManager.setAudioSessionActivity(true);
      if (!activated) {
        throw new Error(`Failed to activate audio session for ${target}`);
      }
    } catch (primaryError) {
      if (target !== 'playback') {
        this.sessionMode = null;
        throw primaryError;
      }

      try {
        await AudioManager.setAudioSessionActivity(false);
      } catch {
        // Session may already be inactive.
      }

      this.markIgnoreRouteChange();
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
      });
      const activated = await AudioManager.setAudioSessionActivity(true);
      if (!activated) {
        this.sessionMode = null;
        throw new Error('Failed to activate audio session for playback');
      }
    }

    if (target === 'playback') {
      await this.refreshOutputRouteKey();
    }
  }

  private async configureForRecording(): Promise<void> {
    await this.applySessionMode('recording');
  }

  /** Full session cycle — avoids stale playback state after context teardown. */
  private async forceConfigureForRecording(): Promise<void> {
    this.sessionMode = null;

    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      // Session may already be inactive.
    }

    this.markIgnoreRouteChange();
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
    });
    this.sessionMode = 'recording';

    const activated = await AudioManager.setAudioSessionActivity(true);
    if (!activated) {
      this.sessionMode = null;
      throw new Error('Failed to activate audio session for recording');
    }
  }

  /** Full session cycle after playback interruption / stale sessionMode cache. */
  private async forceConfigureForPlayback(): Promise<void> {
    this.sessionMode = null;

    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      // Session may already be inactive.
    }

    this.markIgnoreRouteChange();
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playback',
      iosMode: 'default',
      iosOptions: ['allowBluetoothA2DP'],
    });
    this.sessionMode = 'playback';

    let activated = await AudioManager.setAudioSessionActivity(true);
    if (!activated) {
      try {
        await AudioManager.setAudioSessionActivity(false);
      } catch {
        // Session may already be inactive.
      }

      this.markIgnoreRouteChange();
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
      });
      activated = await AudioManager.setAudioSessionActivity(true);
      if (!activated) {
        this.sessionMode = null;
        throw new Error('Failed to activate audio session for playback');
      }
    }

    await this.refreshOutputRouteKey();
  }

  private async prepareRecordingRoute(): Promise<void> {
    await this.forceConfigureForRecording();
    await pinBuiltInMicrophone();
    const routeSnapshot = await assertRecordingRouteOk();
    this.recordingCueOutputRoute = classifyCueOutputRoute(
      routeSnapshot.outputCategory
    );
    logRouteSnapshot('recording-start', routeSnapshot);
    if (__DEV__) {
      console.log(
        `[audio route] cueOutputRoute=${this.recordingCueOutputRoute}`
      );
    }
    this.refreshActiveRecordingSampleRate();
  }

  private async configureForPlayback(): Promise<void> {
    await this.applySessionMode('playback');
  }

  private async resetPlaybackGraph(options?: { preserveLayerBuffers?: boolean }): Promise<void> {
    this.stopPlayback();
    this.clearMonitorPlaybackState();
    await this.closeContextAndDisposeGraph();
    if (options?.preserveLayerBuffers) {
      this.pruneLayerBuffers();
    } else {
      this.invalidateLayerBuffers();
    }
    clearReverbIrCache();
  }

  /** Close AudioContext and drop mix/metronome nodes so they cannot outlive it. */
  private async closeContextAndDisposeGraph(): Promise<void> {
    if (this.context) {
      const context = this.context;
      this.context = null;
      try {
        await context.close();
      } catch {
        // Context may already be closed.
      }
    }
    this.disposeMixGraph();
  }

  private clearMonitorPlaybackState(): void {
    // Monitor mix state is cleared when the playback graph is reset.
  }

  /**
   * Hardware rate for listen-playback. Matching the session rate avoids
   * continuous native SRC (common 44.1k context on 48k devices) that cracks
   * under App Switcher / background CPU pressure.
   */
  private getPlaybackContextSampleRate(): number {
    const preferred = Math.round(AudioManager.getDevicePreferredSampleRate());
    if (!Number.isFinite(preferred) || preferred < 8000) {
      return RECORDING_SAMPLE_RATE;
    }
    return preferred;
  }

  private async createAudioContextAtRate(targetRate: number): Promise<AudioContext> {
    try {
      return new AudioContext({ sampleRate: targetRate });
    } catch {
      return new AudioContext();
    }
  }

  private clearRecordingSampleRateState(): void {
    this.activeRecordingSampleRate = null;
    this.recordingUsedWavFormat = false;
  }

  private getRecordingCallbackConfig(): { sampleRate: number; bufferLength: number } {
    return {
      sampleRate: RECORDING_SAMPLE_RATE,
      bufferLength: Math.max(1, Math.round(RECORDING_SAMPLE_RATE * 0.1)),
    };
  }

  private async ensureMonitorContextReady(): Promise<void> {
    const context = await this.ensureRecordingContext();
    await Promise.all(
      this.loadedLayers.map((layer) => this.getDecodedLayerBuffer(layer))
    );
    this.syncMixGraph(context);
  }

  private async beginMonitorPlayback(startTime: number): Promise<void> {
    this.emit({
      monitorMixReady: true,
      currentTime: startTime,
      isPlaying: false,
    });
    await this.play();
  }

  private async ensureRecordingContext(options?: {
    /** Session already configured via prepareRecordingRoute — skip another cycle. */
    sessionReady?: boolean;
  }): Promise<AudioContext> {
    if (!options?.sessionReady) {
      await this.configureForRecording();
    }
    // Match stored layers + recorder file preset (44100) so monitor-mix
    // finalize skips O(duration) resample when device preferred rate is 48k.
    const targetRate = RECORDING_SAMPLE_RATE;

    if (this.context && Math.round(this.context.sampleRate) !== targetRate) {
      await this.closeContextAndDisposeGraph();
    }

    if (!this.context) {
      this.context = await this.createAudioContextAtRate(targetRate);
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context;
  }

  /**
   * Schedule metronome for recording using an already-warmed recording context.
   * Must run synchronously before recorder.start().
   */
  private armMetronomeForRecording(startTime: number, startWhen: number): void {
    if (!this.metronomeSettings.enabled || !this.context) {
      return;
    }

    this.stopMetronomeSources();
    this.metronomeOnlyActive = true;
    this.metronomeScheduledUntil = startTime;
    this.metronomeTimelineOrigin = startTime;
    this.metronomeAudioOrigin = startWhen;
    this.playbackStartAt = startTime;
    this.playbackEndAt = startTime;
    this.playbackContextStartWhen = startWhen;
    this.extendMetronomeOnlySchedule(startTime);
  }

  /**
   * Schedule monitor-mix playback + metronome at a fixed audio time.
   * Uses buffers warmed in finalizeRecordingWarmup — no awaits.
   * Dry-only + tiled windows: skip delay/reverb DSP and only materialize plans for
   * the first schedule chunk (loopUntil footprints can be huge).
   */
  private startMonitorMixAt(startAt: number, startWhen: number): void {
    const context = this.context;
    if (!context) {
      return;
    }

    const timelineDuration = this.state.duration;
    const bounds = this.getPlaybackBounds(timelineDuration);
    const endAt = bounds.end;
    let playStart = Math.max(bounds.start, startAt);
    if (playStart >= endAt - PLAYBACK_END_TOLERANCE) {
      playStart = bounds.start;
    }

    const playDuration = endAt - playStart;
    if (playDuration <= PLAYBACK_END_TOLERANCE) {
      this.monitorMixPlannedUntil = 0;
      if (this.metronomeSettings.enabled) {
        this.armMetronomeForRecording(startAt, startWhen);
      }
      return;
    }

    this.stopMetronomeSources();
    this.stopActiveSources();
    this.clearMetronomeOnlyState();

    this.playbackStartAt = playStart;
    this.playbackEndAt = endAt;
    this.playbackContextStartWhen = startWhen;
    this.playbackRate = 1;
    this.playbackRateAnchorContextTime = startWhen;
    this.playbackRateAnchorPosition = playStart;
    this.layerPlaybackDryOnly = true;

    const horizonEnd = Math.min(endAt, playStart + PLAYBACK_SCHEDULE_CHUNK_SEC);
    const scheduledSources = this.scheduleMonitorMixWindow(playStart, horizonEnd, 0);
    this.monitorMixPlannedUntil = horizonEnd;
    this.pendingLayerPlaybacks = [];

    if (scheduledSources === 0) {
      this.playbackContextStartWhen = 0;
      this.monitorMixPlannedUntil = 0;
      this.resetPlaybackRateClock();
      if (this.metronomeSettings.enabled) {
        this.armMetronomeForRecording(startAt, startWhen);
      }
      return;
    }

    // Chunked schedule — never create the full memo's worth of click nodes at once
    // (same freeze as metronome-only recording on long takes).
    if (this.metronomeSettings.enabled) {
      this.metronomeOnlyActive = true;
      this.metronomeScheduledUntil = playStart;
      this.metronomeTimelineOrigin = playStart;
      this.metronomeAudioOrigin = startWhen;
      this.extendMetronomeOnlySchedule(playStart);
    }
  }

  /**
   * Build and arm monitor-mix plans for [windowStart, windowEnd).
   * `delayBias` shifts plan.delay so it stays relative to playbackStartAt.
   */
  private scheduleMonitorMixWindow(
    windowStart: number,
    windowEnd: number,
    delayBias: number
  ): number {
    const context = this.context;
    if (!context || windowEnd <= windowStart + PLAYBACK_END_TOLERANCE) {
      return 0;
    }

    const planSpecs = filterPlaybackPlansBySilentLayer(
      this.buildPlaybackPlans(windowStart, windowEnd),
      this.monitorSilentLayerId
    );
    const anySoloActive = this.getAnySoloActive();

    let scheduledSources = 0;
    for (const plan of planSpecs) {
      if (!isLayerAudible(plan.playbackEffects, anySoloActive)) {
        continue;
      }

      const buffer = this.recordingPlaybackBuffers.get(plan.layer.path);
      if (!buffer) {
        continue;
      }

      const resolved = resolvePlanAgainstBuffer(plan, buffer.duration);
      if (!resolved) {
        continue;
      }

      scheduledSources += this.scheduleResolvedLayerPlan(context, {
        layer: plan.layer,
        buffer,
        playbackEffects: {
          ...resolved.playbackEffects,
          delay: { ...resolved.playbackEffects.delay, preset: 'off', mix: 0 },
          reverb: { ...resolved.playbackEffects.reverb, preset: 'off', mix: 0 },
        },
        bufferOffset: resolved.bufferOffset,
        delay: resolved.delay + delayBias,
        layerPlayLength: resolved.layerPlayLength,
      });
    }

    return scheduledSources;
  }

  /**
   * Schedule one resolved layer segment within the sliding window.
   * Long segments only arm the first chunk; extendLayerPlaybackSchedule continues them.
   */
  private scheduleResolvedLayerPlan(
    context: AudioContext,
    plan: LayerPlaybackPlan
  ): number {
    const channel = this.mixGraph.getChannel(plan.layer.id);
    if (!channel) {
      return 0;
    }

    const hasDelay =
      !this.layerPlaybackDryOnly && isDelayPathActive(plan.playbackEffects);
    const hasReverb =
      !this.layerPlaybackDryOnly && isReverbPathActive(plan.playbackEffects);
    const layerStartWhen = this.playbackContextStartWhen + plan.delay;
    const firstChunk = Math.min(plan.layerPlayLength, PLAYBACK_SCHEDULE_CHUNK_SEC);
    const stopWhen = layerStartWhen + firstChunk;
    const fadeSchedule = {
      effects: plan.playbackEffects,
      playLength: plan.layerPlayLength,
    };

    const drySources = [
      this.schedulePathSource(
        context,
        channel.dry,
        plan.buffer,
        layerStartWhen,
        stopWhen,
        plan.bufferOffset,
        fadeSchedule
      ),
    ];
    let scheduledSources = 1;

    const delaySources: AudioBufferSourceNode[] = [];
    if (hasDelay && channel.delay) {
      delaySources.push(
        this.schedulePathSource(
          context,
          channel.delay,
          plan.buffer,
          layerStartWhen,
          stopWhen,
          plan.bufferOffset,
          fadeSchedule
        )
      );
      scheduledSources += 1;
    }

    const reverbSources: AudioBufferSourceNode[] = [];
    if (hasReverb && channel.reverb) {
      reverbSources.push(
        this.schedulePathSource(
          context,
          channel.reverb,
          plan.buffer,
          layerStartWhen,
          stopWhen,
          plan.bufferOffset,
          fadeSchedule
        )
      );
      scheduledSources += 1;
    }

    this.activeLayerPlaybacks.push({
      layerId: plan.layer.id,
      hasDelay,
      hasReverb,
      drySources,
      delaySources,
      reverbSources,
      buffer: plan.buffer,
      bufferOffset: plan.bufferOffset,
      scheduleDelay: plan.delay,
      layerPlayLength: plan.layerPlayLength,
      scheduledLength: firstChunk,
      playbackEffects: plan.playbackEffects,
    });

    return scheduledSources;
  }

  private hasLayerPlaybackScheduled(): boolean {
    return this.activeLayerPlaybacks.length > 0 || this.pendingLayerPlaybacks.length > 0;
  }

  private getActiveSegmentsForLayer(layerId: string): ActiveLayerPlayback[] {
    return this.activeLayerPlaybacks.filter((entry) => entry.layerId === layerId);
  }

  private findActiveSegmentAtElapsed(
    layerId: string,
    elapsed: number
  ): ActiveLayerPlayback | undefined {
    return this.getActiveSegmentsForLayer(layerId).find((active) => {
      const start = this.playbackStartAt + active.scheduleDelay;
      const end = start + active.layerPlayLength;
      return (
        elapsed >= start - PLAYBACK_END_TOLERANCE &&
        elapsed < end - PLAYBACK_END_TOLERANCE
      );
    });
  }

  /** Promote pending cycle segments and extend within-segment chunks. */
  private extendLayerPlaybackSchedule(timelineNow: number): void {
    if (!this.context || this.playbackContextStartWhen <= 0) {
      return;
    }
    if (!this.hasLayerPlaybackScheduled()) {
      return;
    }

    const context = this.context;
    const elapsed = Math.max(0, timelineNow - this.playbackStartAt);
    const horizon = elapsed + PLAYBACK_SCHEDULE_CHUNK_SEC;

    if (this.pendingLayerPlaybacks.length > 0) {
      const stillPending: LayerPlaybackPlan[] = [];
      for (const plan of this.pendingLayerPlaybacks) {
        if (plan.delay < horizon) {
          this.scheduleResolvedLayerPlan(context, plan);
        } else {
          stillPending.push(plan);
        }
      }
      this.pendingLayerPlaybacks = stillPending;
    }

    for (const active of this.activeLayerPlaybacks) {
      const remaining = active.layerPlayLength - active.scheduledLength;
      if (remaining <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      const scheduledEndTimeline =
        this.playbackStartAt + active.scheduleDelay + active.scheduledLength;
      if (timelineNow < scheduledEndTimeline - PLAYBACK_SCHEDULE_EXTEND_LEAD_SEC) {
        continue;
      }

      const channel = this.mixGraph.getChannel(active.layerId);
      if (!channel) {
        continue;
      }

      const chunk = Math.min(remaining, PLAYBACK_SCHEDULE_CHUNK_SEC);
      const chunkStartWhen =
        this.playbackContextStartWhen + active.scheduleDelay + active.scheduledLength;
      const chunkBufferOffset = active.bufferOffset + active.scheduledLength;

      active.drySources.push(
        this.schedulePathSource(
          context,
          channel.dry,
          active.buffer,
          chunkStartWhen,
          chunkStartWhen + chunk,
          chunkBufferOffset
        )
      );
      if (active.hasDelay && channel.delay) {
        active.delaySources.push(
          this.schedulePathSource(
            context,
            channel.delay,
            active.buffer,
            chunkStartWhen,
            chunkStartWhen + chunk,
            chunkBufferOffset
          )
        );
      }
      if (active.hasReverb && channel.reverb) {
        active.reverbSources.push(
          this.schedulePathSource(
            context,
            channel.reverb,
            active.buffer,
            chunkStartWhen,
            chunkStartWhen + chunk,
            chunkBufferOffset
          )
        );
      }
      active.scheduledLength += chunk;
    }
  }

  /** Schedule all remaining layer audio through playbackEndAt (background handoff). */
  private extendLayerPlaybackThroughEnd(): void {
    if (!this.context || this.playbackContextStartWhen <= 0 || this.playbackEndAt <= 0) {
      return;
    }

    let guard = 0;
    while (this.hasLayerPlaybackScheduled() && guard < 200) {
      const beforePending = this.pendingLayerPlaybacks.length;
      const beforeScheduled = this.activeLayerPlaybacks.reduce(
        (sum, active) => sum + active.scheduledLength,
        0
      );
      this.extendLayerPlaybackSchedule(this.playbackEndAt);
      const afterScheduled = this.activeLayerPlaybacks.reduce(
        (sum, active) => sum + active.scheduledLength,
        0
      );
      const pendingShrunk = this.pendingLayerPlaybacks.length < beforePending;
      const chunksGrew = afterScheduled > beforeScheduled + 0.001;
      const allChunksDone = this.activeLayerPlaybacks.every(
        (active) =>
          active.layerPlayLength - active.scheduledLength <= PLAYBACK_END_TOLERANCE
      );
      if (
        (!pendingShrunk && !chunksGrew) ||
        (this.pendingLayerPlaybacks.length === 0 && allChunksDone)
      ) {
        break;
      }
      guard += 1;
    }
  }

  /** Extend tiled monitor-mix layer sources while recording. */
  private extendMonitorMixSchedule(timelineNow: number): void {
    if (
      !this.state.isRecording ||
      !this.state.monitorMixActive ||
      !this.context ||
      this.playbackContextStartWhen <= 0
    ) {
      return;
    }

    if (this.hasLayerPlaybackScheduled()) {
      this.extendLayerPlaybackSchedule(timelineNow);
    }

    if (this.monitorMixPlannedUntil <= 0) {
      return;
    }
    if (
      timelineNow <
      this.monitorMixPlannedUntil - PLAYBACK_SCHEDULE_EXTEND_LEAD_SEC
    ) {
      return;
    }

    const windowStart = this.monitorMixPlannedUntil;
    const windowEnd = Math.min(
      this.playbackEndAt,
      windowStart + PLAYBACK_SCHEDULE_CHUNK_SEC
    );
    if (windowEnd <= windowStart + PLAYBACK_END_TOLERANCE) {
      return;
    }

    const delayBias = windowStart - this.playbackStartAt;
    this.scheduleMonitorMixWindow(windowStart, windowEnd, delayBias);
    this.monitorMixPlannedUntil = windowEnd;
  }

  /**
   * Schedule metronome clicks while recording without monitor-mix playback
   * (first track / single-layer replace). Uses short sliding windows so we
   * never create thousands of AudioBufferSourceNodes at once.
   */
  private async beginMetronomeOnlyDuringRecording(startTime: number): Promise<void> {
    if (!this.metronomeSettings.enabled) {
      return;
    }

    const context = await this.ensureRecordingContext();
    this.syncMixGraph(context);

    const when = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
    this.armMetronomeForRecording(startTime, when);
  }

  private extendMetronomeOnlySchedule(timelineNow: number): void {
    if (
      !this.metronomeOnlyActive ||
      !this.context ||
      !this.metronomeSettings.enabled ||
      this.metronomeAudioOrigin <= 0
    ) {
      return;
    }

    const scheduleFrom = this.metronomeScheduledUntil;
    let scheduleTo =
      Math.max(scheduleFrom, timelineNow) + METRONOME_SCHEDULE_CHUNK_SEC;
    // Cap at playback end for monitor-mix / normal playback so long loops
    // do not schedule an unbounded click window past the segment.
    const capAtPlaybackEnd =
      this.hasLayerPlaybackScheduled() || !this.state.isRecording;
    if (capAtPlaybackEnd && this.playbackEndAt > 0) {
      scheduleTo = Math.min(scheduleTo, this.playbackEndAt);
    }
    if (scheduleTo <= scheduleFrom + 0.001) {
      return;
    }

    const context = this.context;
    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;
    const startWhen =
      this.metronomeAudioOrigin + (scheduleFrom - this.metronomeTimelineOrigin);
    const sources = scheduleMetronomeClicks(
      context,
      gain,
      this.metronomeSettings,
      scheduleFrom,
      scheduleTo,
      startWhen
    );
    this.metronomeSources.push(...sources);
    for (const source of sources) {
      source.onEnded = () => {
        const index = this.metronomeSources.indexOf(source);
        if (index >= 0) {
          this.metronomeSources.splice(index, 1);
        }
      };
    }
    this.metronomeScheduledUntil = scheduleTo;
    // Keep monitor-mix end intact — only metronome-only mode extends playbackEndAt.
    if (!this.hasLayerPlaybackScheduled() && this.state.isRecording) {
      this.playbackEndAt = scheduleTo;
    }
  }

  private clearMetronomeOnlyState(): void {
    this.metronomeOnlyActive = false;
    this.metronomeScheduledUntil = 0;
    this.metronomeAudioOrigin = 0;
    this.metronomeTimelineOrigin = 0;
  }

  private refreshActiveRecordingSampleRate(): void {
    this.activeRecordingSampleRate = Math.round(
      AudioManager.getDevicePreferredSampleRate()
    );
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.state.isRecording) {
      // Keep monitor-mix / in-take graph on the recording rate.
      return this.ensureRecordingContext();
    }

    await this.configureForPlayback();

    const sessionRate = this.getPlaybackContextSampleRate();

    // Only recreate when leaving a leftover recording-rate context for a
    // different hardware rate. Do not thrash when AVAudioSession.sampleRate
    // flickers between play() calls — that broke first-play after the 48k change.
    if (
      this.context &&
      Math.round(this.context.sampleRate) === RECORDING_SAMPLE_RATE &&
      sessionRate !== RECORDING_SAMPLE_RATE
    ) {
      await this.closeContextAndDisposeGraph();
    }

    if (!this.context) {
      this.context = await this.createAudioContextAtRate(sessionRate);
      if (__DEV__) {
        console.log(
          `[audio] playback AudioContext at ${Math.round(this.context.sampleRate)} Hz` +
            ` (session ${sessionRate} Hz)`
        );
      }
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context;
  }

  private getLoadedLayerEffects(layer: LoadedLayer): LayerEffects {
    return getLayerEffectsForPlayback(layer);
  }

  private getPlaybackEnd(timelineDuration: number): number {
    const trimEnd = this.state.trimEnd > 0 ? this.state.trimEnd : timelineDuration;
    return Math.min(trimEnd, timelineDuration);
  }

  private hasValidLoop(): boolean {
    return this.state.loopEnd > this.state.loopStart + PLAYBACK_END_TOLERANCE;
  }

  private getPlaybackBounds(timelineDuration: number): { start: number; end: number } {
    if (this.state.loopEnabled && this.hasValidLoop()) {
      return {
        start: this.state.loopStart,
        end: Math.min(this.state.loopEnd, this.getPlaybackEnd(timelineDuration)),
      };
    }
    return {
      start: this.state.trimStart,
      end: this.getPlaybackEnd(timelineDuration),
    };
  }

  private isAtPlaybackEnd(timelineDuration?: number): boolean {
    const duration = timelineDuration ?? this.state.duration;
    const bounds = this.getPlaybackBounds(duration);
    // Past the loop but not past the memo end — not "at end" for restart-at-loop-start.
    if (
      this.state.loopEnabled &&
      this.hasValidLoop() &&
      this.state.currentTime >= bounds.end
    ) {
      return this.state.currentTime >= this.getPlaybackEnd(duration) - PLAYBACK_END_TOLERANCE;
    }
    return this.state.currentTime >= bounds.end - PLAYBACK_END_TOLERANCE;
  }

  private invalidatePlaybackSession(): void {
    this.playbackSessionId += 1;
    this.activePlaybackSessionId = this.playbackSessionId;
  }

  private clearPlaybackTimer(): void {
    if (this.playbackRafId !== null) {
      cancelAnimationFrame(this.playbackRafId);
      this.playbackRafId = null;
    }
    if (this.playbackEndTimeoutId !== null) {
      clearTimeout(this.playbackEndTimeoutId);
      this.playbackEndTimeoutId = null;
    }
  }

  private getElapsedPlaybackTime(context: AudioContext): number {
    if (this.playbackContextStartWhen <= 0) {
      return this.state.currentTime;
    }

    let pos: number;
    if (this.playbackRateAnchorContextTime > 0) {
      const dt = context.currentTime - this.playbackRateAnchorContextTime;
      pos = this.playbackRateAnchorPosition + dt * this.playbackRate;
    } else {
      // Fallback for sessions that have not anchored yet (should be rare).
      const elapsed = context.currentTime - this.playbackContextStartWhen;
      pos = this.playbackStartAt + elapsed * this.playbackRate;
    }

    return Math.max(this.playbackStartAt, Math.min(pos, this.playbackEndAt));
  }

  private getPlaybackRemainingWallMs(context: AudioContext): number {
    const rate = Math.max(0.01, this.playbackRate);
    const remainingSec = Math.max(
      0,
      (this.playbackEndAt - this.getElapsedPlaybackTime(context) - PLAYBACK_END_TOLERANCE) /
        rate
    );
    // Prefer slightly late end vs cutting audio early.
    return Math.ceil(remainingSec * 1000);
  }

  /** Schedule metronome clicks through playbackEndAt (for inactive AppState). */
  private extendMetronomeThroughPlaybackEnd(): void {
    if (!this.metronomeOnlyActive || !this.context || this.playbackEndAt <= 0) {
      return;
    }

    let guard = 0;
    while (
      this.metronomeScheduledUntil < this.playbackEndAt - 0.001 &&
      guard < 100
    ) {
      const before = this.metronomeScheduledUntil;
      this.extendMetronomeOnlySchedule(this.metronomeScheduledUntil);
      if (this.metronomeScheduledUntil <= before + 0.001) {
        break;
      }
      guard += 1;
    }
  }

  private armBackgroundPlaybackEndTimeout(
    sessionId: number,
    context: AudioContext
  ): void {
    this.clearPlaybackTimer();
    this.extendMetronomeThroughPlaybackEnd();
    this.extendLayerPlaybackThroughEnd();

    const remainingMs = this.getPlaybackRemainingWallMs(context);
    this.playbackEndTimeoutId = setTimeout(() => {
      this.playbackEndTimeoutId = null;
      if (sessionId !== this.activePlaybackSessionId || this.state.isRecording) {
        return;
      }

      // Prefer late: if audio clock is still short of end, re-arm.
      if (this.context && this.playbackContextStartWhen > 0) {
        const now = this.getElapsedPlaybackTime(this.context);
        if (now < this.playbackEndAt - PLAYBACK_END_TOLERANCE) {
          this.armBackgroundPlaybackEndTimeout(sessionId, this.context);
          return;
        }
      }

      this.finishPlaybackNaturally(this.playbackEndAt, sessionId);
    }, remainingMs);
  }

  /** Stop UI RAF while inactive; native sources keep playing. */
  private freezePlaybackUiForBackground(): void {
    if (
      this.state.isRecording ||
      !this.state.isPlaying ||
      !this.context ||
      this.playbackContextStartWhen <= 0
    ) {
      return;
    }

    const currentTime = this.getElapsedPlaybackTime(this.context);
    this.emit({ currentTime, isPlaying: true });
    this.armBackgroundPlaybackEndTimeout(this.activePlaybackSessionId, this.context);
  }

  private resumePlaybackUiFromBackground(): void {
    if (
      this.state.isRecording ||
      !this.state.isPlaying ||
      !this.context ||
      this.playbackContextStartWhen <= 0
    ) {
      return;
    }

    this.startPlaybackTimer(this.activePlaybackSessionId, this.context);
  }

  private resetPlaybackRateClock(): void {
    this.playbackRate = 1;
    this.playbackRateAnchorContextTime = 0;
    this.playbackRateAnchorPosition = 0;
  }

  private releaseMonitorMixPlayback(): void {
    this.stopActiveSources();
    this.recordingPlaybackBuffers.clear();
  }

  private startPlaybackTimer(sessionId: number, context: AudioContext): void {
    this.clearPlaybackTimer();

    // During stack/replace monitor mix, UI time comes from the recording timer.
    // Only need a one-shot to tear down finished layer playback at playbackEndAt.
    if (this.state.isRecording) {
      const remainingSec = Math.max(
        0,
        this.playbackEndAt - this.getElapsedPlaybackTime(context) - PLAYBACK_END_TOLERANCE
      );
      this.playbackEndTimeoutId = setTimeout(() => {
        this.playbackEndTimeoutId = null;
        if (sessionId !== this.activePlaybackSessionId || !this.state.isRecording) {
          return;
        }
        // Monitor range ended while still recording — keep the live recording
        // graph; chunked metronome keeps extending via progress.
        this.releaseMonitorMixPlayback();
      }, remainingSec * 1000);
      return;
    }

    // Loop restart / play while App Switcher is up — no RAF, wall-clock end only.
    if (AppState.currentState !== 'active') {
      this.emit({
        currentTime: this.getElapsedPlaybackTime(context),
        isPlaying: true,
      });
      this.armBackgroundPlaybackEndTimeout(sessionId, context);
      return;
    }

    let lastUiUpdateMs = 0;

    const tick = (frameMs: number) => {
      if (sessionId !== this.activePlaybackSessionId) {
        return;
      }

      // App became inactive mid-tick — hand off to background end-timeout.
      if (AppState.currentState !== 'active') {
        this.armBackgroundPlaybackEndTimeout(sessionId, context);
        return;
      }

      const nextTime = this.getElapsedPlaybackTime(context);

      if (frameMs - lastUiUpdateMs >= PLAYBACK_UI_UPDATE_MS) {
        lastUiUpdateMs = frameMs;
        this.emit({ currentTime: nextTime, isPlaying: true });
      }

      if (
        this.metronomeOnlyActive &&
        nextTime >= this.metronomeScheduledUntil - METRONOME_SCHEDULE_EXTEND_LEAD_SEC
      ) {
        this.extendMetronomeOnlySchedule(nextTime);
      }

      if (this.hasLayerPlaybackScheduled()) {
        this.extendLayerPlaybackSchedule(nextTime);
      }

      if (nextTime >= this.playbackEndAt - PLAYBACK_END_TOLERANCE) {
        this.finishPlaybackNaturally(this.playbackEndAt, sessionId);
        return;
      }

      this.playbackRafId = requestAnimationFrame(tick);
    };

    // Fresh play and foreground resume both land here — use the live clock.
    this.emit({
      currentTime: this.getElapsedPlaybackTime(context),
      isPlaying: true,
    });
    this.playbackRafId = requestAnimationFrame(tick);
  }

  private stopSource(source: AudioBufferSourceNode): void {
    source.onPositionChanged = null;
    source.onEnded = null;
    try {
      source.stop();
    } catch {
      // Source may already be stopped.
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private stopActiveSources(): void {
    for (const source of this.sources) {
      this.stopSource(source);
    }
    this.sources = [];
    this.activeLayerPlaybacks = [];
    this.pendingLayerPlaybacks = [];
    this.monitorMixPlannedUntil = 0;
  }

  private stopMetronomeSources(): void {
    for (const source of this.metronomeSources) {
      this.stopSource(source);
    }
    this.metronomeSources = [];
  }

  private invalidateAndStopSources(): void {
    this.invalidatePlaybackSession();
    this.clearPlaybackTimer();
    this.playbackContextStartWhen = 0;
    this.resetPlaybackRateClock();
    this.stopMetronomeSources();
    this.clearMetronomeOnlyState();
    this.stopActiveSources();
  }

  private ensureMetronomeGain(context: AudioContext): GainNode {
    if (this.metronomeGain && this.metronomeGainContext !== context) {
      try {
        this.metronomeGain.disconnect();
      } catch {
        // Already disconnected.
      }
      this.metronomeGain = null;
      this.metronomeGainContext = null;
    }

    if (!this.metronomeGain) {
      const master = this.mixGraph.getMasterGain(context);
      this.metronomeGain = context.createGain();
      this.metronomeGain.gain.value = this.metronomeSettings.volume / 100;
      this.metronomeGain.connect(master);
      this.metronomeGainContext = context;
    }
    return this.metronomeGain;
  }

  private shouldPlayMetronome(): boolean {
    if (!this.metronomeSettings.enabled) {
      return false;
    }
    return this.playbackContextStartWhen > 0 || this.state.isPlaying;
  }

  private scheduleMetronome(
    _context: AudioContext,
    startAt: number,
    _endAt: number,
    startWhen: number
  ): void {
    this.stopMetronomeSources();
    this.clearMetronomeOnlyState();
    if (!this.shouldPlayMetronome()) {
      return;
    }

    // Chunked schedule — same sliding window as recording, so long loop
    // regions never create thousands of click nodes in one shot.
    this.metronomeOnlyActive = true;
    this.metronomeScheduledUntil = startAt;
    this.metronomeTimelineOrigin = startAt;
    this.metronomeAudioOrigin = startWhen;
    this.extendMetronomeOnlySchedule(startAt);
  }

  private resyncMetronome(): void {
    if (!this.context || this.playbackContextStartWhen <= 0) {
      return;
    }

    const startAt = this.getElapsedPlaybackTime(this.context);
    const endAt = this.playbackEndAt;
    const startWhen = this.context.currentTime + PLAYBACK_SCHEDULE_LEAD;
    this.scheduleMetronome(this.context, startAt, endAt, startWhen);
  }

  private disposeMixGraph(): void {
    if (this.metronomeGain) {
      try {
        this.metronomeGain.disconnect();
      } catch {
        // Already disconnected.
      }
      this.metronomeGain = null;
      this.metronomeGainContext = null;
    }
    this.mixGraph.dispose();
    this.mixGraph = new MemoMixGraph();
  }

  private setMasterOutputGain(gain: number): void {
    if (!this.context) {
      return;
    }
    this.mixGraph.getMasterGain(this.context).gain.value = gain;
  }

  private applyPreparedMonitorMixGain(): void {
    this.setMasterOutputGain(
      this.preparedDuckMonitorMix ? SPEAKER_MONITOR_MIX_GAIN : 1
    );
  }

  private clearMonitorMixDuck(): void {
    this.preparedDuckMonitorMix = false;
    this.setMasterOutputGain(1);
  }

  private syncMixGraph(context: AudioContext): void {
    this.mixGraph.syncLayers(
      context,
      this.loadedLayers.map((layer) => ({
        id: layer.id,
        effects: this.getLoadedLayerEffects(layer),
      }))
    );
  }

  private getAnySoloActive(): boolean {
    return hasAnySoloActive(
      this.loadedLayers.map((layer) => this.getLoadedLayerEffects(layer))
    );
  }

  private syncAllLayerGains(context: AudioContext): void {
    const anySoloActive = this.getAnySoloActive();
    for (const layer of this.loadedLayers) {
      const layerId = layer.id;
      const effects = this.getLoadedLayerEffects(layer);
      if (!this.mixGraph.getChannel(layerId)) {
        continue;
      }
      this.mixGraph.applyLayerEffects(context, layerId, effects, anySoloActive);
      for (const active of this.getActiveSegmentsForLayer(layerId)) {
        active.playbackEffects = effects;
      }
    }
  }

  private schedulePathSource(
    context: AudioContext,
    path: LayerEffectPathNodes,
    buffer: AudioBuffer,
    startWhen: number,
    stopWhen: number,
    bufferOffset: number,
    fadeSchedule?: { effects: LayerEffects; playLength: number } | null
  ): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = buffer;
    this.mixGraph.connectSourceToPath(source, path);
    source.start(startWhen, bufferOffset);
    source.stop(stopWhen);
    this.sources.push(source);
    if (fadeSchedule) {
      schedulePathFades(
        path,
        fadeSchedule.effects,
        startWhen,
        fadeSchedule.playLength,
        bufferOffset
      );
    }
    return source;
  }

  /**
   * Hot-add or remove wet paths for one layer without restarting the session.
   * Falls back to full resync if the layer is not in the active play window,
   * or when other scheduled loop segments also need path changes.
   */
  private updateLayerWetPaths(
    context: AudioContext,
    layerId: string,
    nextEffects: LayerEffects
  ): boolean {
    const segments = this.getActiveSegmentsForLayer(layerId);
    if (segments.length === 0) {
      return false;
    }

    const wantDelay = isDelayPathActive(nextEffects);
    const wantReverb = isReverbPathActive(nextEffects);

    for (const segment of segments) {
      segment.playbackEffects = nextEffects;
    }
    for (const pending of this.pendingLayerPlaybacks) {
      if (pending.layer.id === layerId) {
        pending.playbackEffects = nextEffects;
      }
    }

    const anyPathMismatch = segments.some(
      (segment) =>
        segment.hasDelay !== wantDelay || segment.hasReverb !== wantReverb
    );

    if (!anyPathMismatch) {
      this.mixGraph.applyLayerEffects(context, layerId, nextEffects, this.getAnySoloActive());
      return true;
    }

    const elapsed = this.getElapsedPlaybackTime(context);
    const active = this.findActiveSegmentAtElapsed(layerId, elapsed);
    if (!active) {
      return false;
    }

    // Other already-scheduled segments would need wet resync too — restart cleanly.
    const othersNeedUpdate = segments.some(
      (segment) =>
        segment !== active &&
        (segment.hasDelay !== wantDelay || segment.hasReverb !== wantReverb)
    );
    if (othersNeedUpdate) {
      return false;
    }

    const delayChanged = active.hasDelay !== wantDelay;
    const reverbChanged = active.hasReverb !== wantReverb;

    const channel = this.mixGraph.getChannel(layerId);
    if (!channel) {
      return false;
    }

    const remaining =
      active.layerPlayLength - (elapsed - (this.playbackStartAt + active.scheduleDelay));
    if (remaining <= PLAYBACK_END_TOLERANCE) {
      return false;
    }

    const startWhen = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
    const playedInLayer = Math.max(
      0,
      elapsed - (this.playbackStartAt + active.scheduleDelay)
    );
    const bufferOffset = active.bufferOffset + playedInLayer;
    const maxBufferOffset = active.playbackEffects.trimOut - PLAYBACK_END_TOLERANCE;
    if (bufferOffset >= maxBufferOffset) {
      return false;
    }

    const layerPlayLength = Math.min(remaining, active.playbackEffects.trimOut - bufferOffset);
    if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
      return false;
    }

    const stopWhen = startWhen + layerPlayLength;

    const stopTrackedSources = (sources: AudioBufferSourceNode[]) => {
      for (const source of sources) {
        this.stopSource(source);
        const index = this.sources.indexOf(source);
        if (index >= 0) {
          this.sources.splice(index, 1);
        }
      }
    };

    // Stop removed wet sources before tearing down their bus sends.
    if (delayChanged && !wantDelay) {
      stopTrackedSources(active.delaySources);
      active.delaySources = [];
    }
    if (reverbChanged && !wantReverb) {
      stopTrackedSources(active.reverbSources);
      active.reverbSources = [];
    }

    this.mixGraph.applyLayerEffects(context, layerId, nextEffects, this.getAnySoloActive());
    const nextChannel = this.mixGraph.getChannel(layerId);
    if (!nextChannel) {
      return false;
    }

    if (delayChanged && wantDelay) {
      stopTrackedSources(active.delaySources);
      active.delaySources = [];
      if (!nextChannel.delay) {
        return false;
      }
      active.delaySources.push(
        this.schedulePathSource(
          context,
          nextChannel.delay,
          active.buffer,
          startWhen,
          stopWhen,
          bufferOffset,
          { effects: nextEffects, playLength: layerPlayLength }
        )
      );
    }

    if (reverbChanged && wantReverb) {
      stopTrackedSources(active.reverbSources);
      active.reverbSources = [];
      if (!nextChannel.reverb) {
        return false;
      }
      active.reverbSources.push(
        this.schedulePathSource(
          context,
          nextChannel.reverb,
          active.buffer,
          startWhen,
          stopWhen,
          bufferOffset,
          { effects: nextEffects, playLength: layerPlayLength }
        )
      );
    }

    active.hasDelay = wantDelay;
    active.hasReverb = wantReverb;
    // Keep schedule metadata aligned for further hot updates.
    active.bufferOffset = bufferOffset;
    active.scheduleDelay = elapsed - this.playbackStartAt;
    active.layerPlayLength = layerPlayLength;
    active.scheduledLength = Math.min(active.scheduledLength, layerPlayLength);
    active.playbackEffects = nextEffects;
    return true;
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private invalidateLayerBuffers(): void {
    this.layerBuffers.clear();
    this.resampledLayerBuffers.clear();
  }

  private invalidateLayerBufferForPath(path: string): void {
    if (!path) {
      return;
    }
    this.layerBuffers.delete(path);
    for (const key of getResampledCacheKeysForPath(
      path,
      this.resampledLayerBuffers.keys()
    )) {
      this.resampledLayerBuffers.delete(key);
    }
  }

  /** Evict decoded/resampled PCM for a layer file (e.g. after in-place replace). */
  invalidateLayerBuffer(path: string): void {
    this.invalidateLayerBufferForPath(path);
    this.resetRecordingWarmupCaches();
  }

  private resetRecordingWarmupCaches(): void {
    this.recordingPlaybackBuffers.clear();
    this.recordingWarmupFinalized = false;
    this.recordingPrepared = false;
  }

  private pruneLayerBuffers(): void {
    const activePaths = new Set(this.loadedLayers.map((layer) => layer.path));
    for (const path of this.layerBuffers.keys()) {
      if (!activePaths.has(path)) {
        this.layerBuffers.delete(path);
      }
    }
    for (const key of this.resampledLayerBuffers.keys()) {
      const path = key.slice(0, key.lastIndexOf('@'));
      if (!activePaths.has(path)) {
        this.resampledLayerBuffers.delete(key);
      }
    }
  }

  private resampledBufferKey(path: string, contextRate: number): string {
    return `${path}@${contextRate}`;
  }

  private async getDecodedLayerBuffer(layer: LoadedLayer): Promise<AudioBuffer> {
    const cached = this.layerBuffers.get(layer.path);
    if (cached) {
      return cached;
    }
    const buffer = await decodeAudioData(layer.path);
    this.layerBuffers.set(layer.path, buffer);
    return buffer;
  }

  /**
   * Seed the decoded-layer cache after loadMemo (which clears buffers).
   * Path must be the final layer file URI. Sample rate is the file rate;
   * getLayerBuffer still resamples to the context rate when needed.
   */
  primeLayerBuffer(path: string, buffer: AudioBuffer): void {
    if (!path || buffer.length <= 0) {
      return;
    }
    this.invalidateLayerBufferForPath(path);
    this.layerBuffers.set(path, buffer);
  }

  async createBufferFromSamples(
    samples: Float32Array,
    sampleRate: number
  ): Promise<AudioBuffer> {
    const context = await this.ensureContext();
    const rate = Math.round(sampleRate);
    const buffer = context.createBuffer(1, Math.max(1, samples.length), rate);
    // copyToChannel may require a plain Float32Array backed by its own buffer.
    const channel = samples.buffer.byteLength === samples.length * 4 && samples.byteOffset === 0
      ? samples
      : new Float32Array(samples);
    buffer.copyToChannel(channel, 0);
    return buffer;
  }

  private async getLayerBuffer(context: AudioContext, layer: LoadedLayer): Promise<AudioBuffer> {
    const contextRate = Math.round(context.sampleRate);
    const cacheKey = this.resampledBufferKey(layer.path, contextRate);
    const cachedResampled = this.resampledLayerBuffers.get(cacheKey);
    if (cachedResampled) {
      return cachedResampled;
    }

    // Native decode-at-rate: avoids multi-second JS resample on first play when
    // the playback context is 48k and files are 44.1k (felt like "play is broken").
    try {
      const decodedAtRate = await decodeAudioData(layer.path, contextRate);
      if (Math.round(decodedAtRate.sampleRate) === contextRate) {
        this.resampledLayerBuffers.set(cacheKey, decodedAtRate);
        return decodedAtRate;
      }
    } catch {
      // Fall through to file-rate decode + JS resample.
    }

    const decoded = await this.getDecodedLayerBuffer(layer);
    const bufferRate = Math.round(decoded.sampleRate);

    if (bufferRate === contextRate) {
      return decoded;
    }

    if (__DEV__) {
      console.log(
        `[audio] resampling layer for playback: ${bufferRate} Hz -> ${contextRate} Hz`
      );
    }

    const resampled = await resampleMonoBufferFromRateAsync(
      decoded,
      bufferRate,
      contextRate,
      context
    );
    this.resampledLayerBuffers.set(cacheKey, resampled);
    return resampled;
  }

  private buildPlaybackPlans(
    startAt: number,
    endAt: number
  ): Omit<LayerPlaybackPlan, 'buffer'>[] {
    return buildLayerPlaybackPlans(this.loadedLayers, startAt, endAt, (layer) =>
      this.getLoadedLayerEffects(layer)
    );
  }

  private finishPlaybackNaturally(endAt: number, sessionId: number): void {
    if (sessionId !== this.activePlaybackSessionId) {
      return;
    }
    if (this.state.loopEnabled && this.hasValidLoop()) {
      const loopEnd = Math.min(this.state.loopEnd, this.getPlaybackEnd(this.state.duration));
      // Only wrap when this play segment ended at the loop end, not after playing past it.
      if (endAt <= loopEnd + PLAYBACK_END_TOLERANCE) {
        this.clearPlaybackTimer();
        this.stopMetronomeSources();
        this.stopActiveSources();
        this.playbackContextStartWhen = 0;
        this.resetPlaybackRateClock();
        this.emit({ currentTime: this.state.loopStart, isPlaying: true });
        void this.play({ loopRestart: true });
        return;
      }
    }
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: endAt });
    if (!this.state.isRecording) {
      this.setPlaybackInterruptionObservation(false);
      void endMemoLiveActivity();
    }
  }

  private resyncPlaybackAtCurrentTime(): void {
    if (!this.state.isPlaying) {
      return;
    }
    const currentTime = this.context
      ? this.getElapsedPlaybackTime(this.context)
      : this.state.currentTime;
    this.invalidateAndStopSources();
    this.emit({ currentTime, isPlaying: false });
    void this.play();
  }

  private toAbsolutePeaks(raw: number[]): number[] {
    return raw.map(peakToAbsoluteScale);
  }

  private recordingPeakBarCount(duration: number): number {
    return Math.max(
      1,
      Math.floor((duration * WAVEFORM_PIXELS_PER_SECOND) / RECORDING_BAR_STEP)
    );
  }

  private trimRawPeaksToDuration(raw: number[], duration: number): number[] {
    return raw.slice(0, this.recordingPeakBarCount(duration));
  }

  private emitRecordingProgress(): void {
    if (!this.recorder) {
      return;
    }
    const duration = this.recorder.getCurrentDuration();
    const timelineNow = this.playbackStartAt + duration;

    if (this.state.monitorMixActive) {
      this.extendMonitorMixSchedule(timelineNow);
    }

    if (this.metronomeOnlyActive) {
      if (timelineNow >= this.metronomeScheduledUntil - METRONOME_SCHEDULE_EXTEND_LEAD_SEC) {
        this.extendMetronomeOnlySchedule(timelineNow);
      }
    }

    const barCount = this.recordingPeakBarCount(duration);
    let peaks = this.lastEmittedRecordingPeaks;
    if (barCount !== this.lastEmittedRecordingPeakCount) {
      const next = appendAbsoluteRecordingPeaks(
        this.recordingPeaksBuffer,
        barCount,
        this.lastEmittedRecordingPeaks,
        this.lastEmittedRecordingPeakCount
      );
      peaks = next.peaks;
      this.lastEmittedRecordingPeaks = next.peaks;
      this.lastEmittedRecordingPeakCount = next.count;
    }

    if (
      peaks === this.state.recordingPeaks &&
      Math.abs(duration - this.state.recordingDuration) < 0.05
    ) {
      return;
    }

    this.emit({ recordingDuration: duration, recordingPeaks: peaks });
  }

  async requestPermission(): Promise<boolean> {
    const status = await AudioManager.requestRecordingPermissions();
    return status === 'Granted';
  }

  private stopPlayback(): void {
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false });
    if (!this.state.isRecording) {
      this.setPlaybackInterruptionObservation(false);
      void endMemoLiveActivity();
    }
  }

  async loadMemo(
    memoId: string,
    memoTitle: string,
    layers: LoadedLayer[],
    trimStart: number,
    trimEnd: number,
    timelineDuration: number,
    loopStart = 0,
    loopEnd = 0,
    loopEnabled = false
  ): Promise<void> {
    void endMemoLiveActivity();
    this.stopPlayback();
    this.disposeMixGraph();
    clearReverbIrCache();

    const previousLayers = this.loadedLayers;
    const pathsToInvalidate = layersNeedingBufferInvalidation(previousLayers, layers);
    for (const path of pathsToInvalidate) {
      this.invalidateLayerBufferForPath(path);
    }
    if (pathsToInvalidate.length > 0) {
      this.resetRecordingWarmupCaches();
    }

    this.loadedLayers = layers;
    // Keep decoded PCM for unchanged layer paths across stack save/reload.
    this.pruneLayerBuffers();
    const trimEndResolved = trimEnd > 0
      ? Math.min(trimEnd, timelineDuration)
      : timelineDuration;

    this.emit({
      memoId,
      memoTitle,
      duration: timelineDuration,
      trimStart,
      trimEnd: trimEndResolved,
      loopStart,
      loopEnd,
      loopEnabled,
      currentTime: trimStart,
      isPlaying: false,
    });
  }

  setLoopRegion(start: number, end: number, enabled?: boolean): void {
    const duration = this.state.duration;
    const clampedStart = Math.max(0, Math.min(start, duration));
    const clampedEnd = Math.max(0, Math.min(end, duration));
    const loopEnabledChanging =
      enabled !== undefined && enabled !== this.state.loopEnabled;
    const partial: Partial<EngineState> = {
      loopStart: clampedStart,
      loopEnd: clampedEnd,
    };
    if (enabled !== undefined) {
      partial.loopEnabled = enabled;
    }
    this.emit(partial);
    if (loopEnabledChanging) {
      this.resyncPlaybackAtCurrentTime();
    }
  }

  setLoopEnabled(enabled: boolean): void {
    if (enabled === this.state.loopEnabled) {
      return;
    }
    this.emit({ loopEnabled: enabled });
    this.resyncPlaybackAtCurrentTime();
  }

  setMetronome(settings: MetronomeSettings): void {
    const normalized = normalizeMetronomeSettings(settings);
    this.metronomeSettings = normalized;
    this.emit({ metronome: normalized });

    if (this.context && this.metronomeGain) {
      this.metronomeGain.gain.value = normalized.volume / 100;
    }

    if (this.playbackContextStartWhen > 0) {
      this.resyncMetronome();
    }
  }

  /** Warm AudioContext + metronome bus so the first precount click is not dropped. */
  async primeMetronomeOutput(): Promise<void> {
    if (!this.allowPrecountClicks) {
      return;
    }
    const context = await this.getContextForPrecountClick();
    if (!this.allowPrecountClicks || !context) {
      return;
    }
    prewarmMetronomeClickBuffers(context);
    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;

    const primeSource = playSilentMetronomePrime(context, gain);
    this.metronomeSources.push(primeSource);
    primeSource.onEnded = () => {
      const index = this.metronomeSources.indexOf(primeSource);
      if (index >= 0) {
        this.metronomeSources.splice(index, 1);
      }
    };

    await new Promise<void>((resolve) =>
      setTimeout(resolve, PRECOUNT_SILENT_PRIME_SETTLE_MS)
    );
  }

  /** One-shot click for precount (independent of metronome enabled). */
  async playMetronomeClick(options: { accent?: boolean } = {}): Promise<void> {
    if (!this.allowPrecountClicks) {
      return;
    }
    const context = await this.getContextForPrecountClick();
    if (!this.allowPrecountClicks || !context || this.context !== context) {
      return;
    }
    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;
    const source = scheduleOneMetronomeClick(context, gain, {
      accent: options.accent,
      scheduleLeadSec: PRECOUNT_CLICK_LEAD_SEC,
    });
    this.metronomeSources.push(source);
    source.onEnded = () => {
      const index = this.metronomeSources.indexOf(source);
      if (index >= 0) {
        this.metronomeSources.splice(index, 1);
      }
    };
  }

  /**
   * Prefer the recording context after finalizeRecordingWarmup so precount
   * clicks do not flip the session back to playback.
   */
  private async getContextForPrecountClick(): Promise<AudioContext | null> {
    if (this.recordingWarmupFinalized && this.context) {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return this.context;
    }
    return this.ensureContext();
  }

  updateLayerEffects(layerId: string, partial: LayerEffectsChange): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }

    const segments = this.getActiveSegmentsForLayer(layerId);
    const current = this.getLoadedLayerEffects(layer);
    layer.effects = mergeLayerEffects(current, partial, layer.duration);
    const nextEffects = this.getLoadedLayerEffects(layer);

    const needsPathChange =
      this.state.isPlaying &&
      segments.length > 0 &&
      segments.some(
        (active) =>
          active.hasDelay !== isDelayPathActive(nextEffects) ||
          active.hasReverb !== isReverbPathActive(nextEffects)
      );

    if (needsPathChange && this.context) {
      if (this.updateLayerWetPaths(this.context, layerId, nextEffects)) {
        return;
      }
      const currentTime = this.getElapsedPlaybackTime(this.context);
      this.invalidateAndStopSources();
      this.emit({ currentTime, isPlaying: false });
      void this.play();
      return;
    }

    if (this.context) {
      if (partial.solo !== undefined) {
        this.syncAllLayerGains(this.context);
        return;
      }
      this.mixGraph.applyLayerEffects(
        this.context,
        layerId,
        nextEffects,
        this.getAnySoloActive()
      );
      if (segments.length > 0) {
        for (const active of segments) {
          active.playbackEffects = nextEffects;
        }
        for (const pending of this.pendingLayerPlaybacks) {
          if (pending.layer.id === layerId) {
            pending.playbackEffects = nextEffects;
          }
        }
        const fadesChanged =
          partial.fadeInSec !== undefined ||
          partial.fadeOutSec !== undefined ||
          partial.fadeInCurve !== undefined ||
          partial.fadeOutCurve !== undefined ||
          partial.trimIn !== undefined ||
          partial.trimOut !== undefined;
        if (fadesChanged && this.state.isPlaying) {
          this.rescheduleActiveLayerFades(this.context, layerId, nextEffects);
        }
      }
    }
  }

  private rescheduleActiveLayerFades(
    context: AudioContext,
    layerId: string,
    effects: LayerEffects
  ): void {
    const channel = this.mixGraph.getChannel(layerId);
    if (!channel || this.playbackContextStartWhen <= 0) {
      return;
    }

    const elapsed = this.getElapsedPlaybackTime(context);
    const active = this.findActiveSegmentAtElapsed(layerId, elapsed);
    if (!active) {
      return;
    }

    const playedInLayer = Math.max(
      0,
      elapsed - (this.playbackStartAt + active.scheduleDelay)
    );
    const remaining = active.layerPlayLength - playedInLayer;
    if (remaining <= PLAYBACK_END_TOLERANCE) {
      return;
    }

    const startWhen = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
    const bufferOffset = active.bufferOffset + playedInLayer;
    schedulePathFades(channel.dry, effects, startWhen, remaining, bufferOffset);
    if (active.hasDelay && channel.delay) {
      schedulePathFades(channel.delay, effects, startWhen, remaining, bufferOffset);
    }
    if (active.hasReverb && channel.reverb) {
      schedulePathFades(channel.reverb, effects, startWhen, remaining, bufferOffset);
    }
  }

  updateLayerStartTime(layerId: string, startTime: number): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }
    const delta = startTime - layer.startTime;
    layer.startTime = startTime;
    if (layer.loopUntil != null && Number.isFinite(layer.loopUntil) && delta !== 0) {
      layer.loopUntil = layer.loopUntil + delta;
    }
  }

  updateLayerLoopUntil(layerId: string, loopUntil: number | undefined): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }
    if (loopUntil == null || !Number.isFinite(loopUntil)) {
      delete layer.loopUntil;
      return;
    }
    const effects = this.getLoadedLayerEffects(layer);
    const contentEnd = layer.startTime + effects.trimOut;
    if (loopUntil <= contentEnd + 0.001) {
      delete layer.loopUntil;
      return;
    }
    layer.loopUntil = loopUntil;
  }

  updateLayerStartTimes(updates: Record<string, number>): void {
    for (const [layerId, startTime] of Object.entries(updates)) {
      this.updateLayerStartTime(layerId, startTime);
    }
  }

  updateTimelineDuration(timelineDuration: number, trimEnd?: number): void {
    const previousPlaybackEnd = this.getPlaybackEnd(this.state.duration);
    const nextTrimEnd =
      trimEnd !== undefined
        ? Math.max(0, Math.min(trimEnd, timelineDuration))
        : this.state.trimEnd > 0
          ? Math.min(this.state.trimEnd, timelineDuration)
          : timelineDuration;
    let loopStart = this.state.loopStart;
    let loopEnd = this.state.loopEnd;
    let loopEnabled = this.state.loopEnabled;
    loopStart = Math.max(0, Math.min(loopStart, timelineDuration));
    loopEnd = Math.max(0, Math.min(loopEnd, timelineDuration));
    if (loopEnd <= loopStart + PLAYBACK_END_TOLERANCE) {
      loopStart = 0;
      loopEnd = 0;
      loopEnabled = false;
    }
    this.emit({
      duration: timelineDuration,
      trimEnd: nextTrimEnd,
      loopStart,
      loopEnd,
      loopEnabled,
    });
    const nextPlaybackEnd = this.getPlaybackEnd(timelineDuration);
    if (
      this.state.isPlaying &&
      Math.abs(nextPlaybackEnd - previousPlaybackEnd) > PLAYBACK_END_TOLERANCE
    ) {
      this.resyncPlaybackAtCurrentTime();
    }
  }

  unload(): void {
    this.stopPlayback();
    this.loadedLayers = [];
    this.metronomeSettings = DEFAULT_METRONOME_SETTINGS;
    this.disposeMixGraph();
    clearReverbIrCache();
    this.invalidateLayerBuffers();
    this.emit({ ...initialState });
  }

  async startRecording(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
    monitorStartTime?: number;
    silentLayerId?: string;
  }): Promise<void> {
    this.stopMetronomePreview();
    if (this.state.isRecording) {
      return;
    }
    if (this.recordingStartInFlight) {
      return this.recordingStartInFlight;
    }

    const startPromise = (async () => {
      await this.prepareRecordingStart({
        monitorMix: options?.monitorMix,
        duckMonitorMix: options?.duckMonitorMix,
      });
      await this.performCommitRecordingStart(options);
    })();
    this.recordingStartInFlight = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.recordingStartInFlight === startPromise) {
        this.recordingStartInFlight = null;
      }
    }
  }

  /**
   * Warm permission, recorder allocation, and monitor-mix buffers without
   * tearing down the current playback/precount AudioContext (Phase A).
   */
  async prepareRecordingStart(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
  }): Promise<void> {
    if (this.state.isRecording || this.recordingPrepared) {
      return;
    }
    if (this.recordingPrepareInFlight) {
      return this.recordingPrepareInFlight;
    }

    const preparePromise = this.performPrepareRecordingStart(options);
    this.recordingPrepareInFlight = preparePromise;
    try {
      await preparePromise;
    } finally {
      if (this.recordingPrepareInFlight === preparePromise) {
        this.recordingPrepareInFlight = null;
      }
    }
  }

  private async performPrepareRecordingStart(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
  }): Promise<void> {
    if (this.state.isRecording || this.recordingPrepared) {
      return;
    }

    // Fresh arm — clear abort left by a prior cancelPreparedRecording / abort.
    this.recordingStartAborted = false;

    const monitorMix = options?.monitorMix ?? false;
    this.preparedMonitorMix = monitorMix;
    this.preparedDuckMonitorMix = Boolean(monitorMix && options?.duckMonitorMix);

    const granted = await this.requestPermission();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }

    if (this.state.isRecording) {
      return;
    }

    if (this.deferredPlaybackSetup || this.pendingEngineReload) {
      await this.finishDeferredPlaybackSetup();
    }

    this.clearRecordingSampleRateState();

    if (this.recorder) {
      try {
        this.recorder.clearOnAudioReady();
        this.recorder.stop();
      } catch {
        // Stale recorder from interrupted session.
      }
      this.recorder = null;
    }

    this.recordingUsedWavFormat = true;
    this.recorder = new AudioRecorder();
    const result = this.recorder.enableFileOutput({
      format: FileFormat.Wav,
      preset: RECORDING_FILE_PRESET,
      directory: FileDirectory.Cache,
      subDirectory: 'voice-memos-plus',
      fileNamePrefix: 'recording',
      channelCount: 1,
    });

    if (result.status === 'error') {
      this.recorder = null;
      throw new Error(result.message);
    }

    const callbackConfig = this.getRecordingCallbackConfig();

    this.recordingPeaksBuffer = [];
    this.lastEmittedRecordingPeakCount = -1;
    this.lastEmittedRecordingPeaks = [];
    this.recorder.onAudioReady(
      {
        sampleRate: callbackConfig.sampleRate,
        bufferLength: callbackConfig.bufferLength,
        channelCount: 1,
      },
      ({ buffer }) => {
        const channelData = buffer.getChannelData(0);
        const bufferEndSec = this.recorder?.getCurrentDuration() ?? 0;
        const bufferStartSec = Math.max(
          0,
          bufferEndSec - channelData.length / callbackConfig.sampleRate
        );
        this.recordingPeaksBuffer = accumulatePeaksFromSamples(
          channelData,
          bufferStartSec,
          callbackConfig.sampleRate,
          this.recordingPeaksBuffer
        );
      }
    );

    if (monitorMix && this.loadedLayers.length > 0) {
      await Promise.all(
        this.loadedLayers.map((layer) => this.getDecodedLayerBuffer(layer))
      );
    }

    this.recordingPrepared = true;
  }

  /**
   * Route + recording AudioContext before precount / commit.
   * Leaves context alive for precount clicks and atomic commit.
   */
  async finalizeRecordingWarmup(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    // Fast path first — never await prepare in-flight if already warm (avoids hang).
    if (this.recordingWarmupFinalized && this.context && this.recorder) {
      if (options?.duckMonitorMix != null) {
        this.preparedDuckMonitorMix = Boolean(
          (options.monitorMix ?? this.preparedMonitorMix) && options.duckMonitorMix
        );
      }
      this.applyPreparedMonitorMixGain();
      return;
    }

    if (this.recordingPrepareInFlight) {
      await this.recordingPrepareInFlight;
    }

    if (!this.recordingPrepared || !this.recorder) {
      await this.prepareRecordingStart({
        monitorMix: options?.monitorMix,
        duckMonitorMix: options?.duckMonitorMix,
      });
    } else if (options?.duckMonitorMix != null) {
      this.preparedDuckMonitorMix = Boolean(
        (options.monitorMix ?? this.preparedMonitorMix) && options.duckMonitorMix
      );
    }

    if (this.recordingWarmupFinalized && this.context && this.recorder) {
      this.applyPreparedMonitorMixGain();
      return;
    }

    const monitorMix = options?.monitorMix ?? this.preparedMonitorMix;

    try {
      await this.resetPlaybackGraph({
        preserveLayerBuffers: this.loadedLayers.length > 0,
      });

      if (!this.recorder) {
        this.recordingPrepared = false;
        throw new Error('Recording was not prepared');
      }

      await this.prepareRecordingRoute();

      const context = await this.ensureRecordingContext({ sessionReady: true });
      this.syncMixGraph(context);
      this.applyPreparedMonitorMixGain();

      this.recordingPlaybackBuffers.clear();
      if (monitorMix && this.loadedLayers.length > 0) {
        await Promise.all(
          this.loadedLayers.map(async (layer) => {
            const buffer = await this.getLayerBuffer(context, layer);
            this.recordingPlaybackBuffers.set(layer.path, buffer);
          })
        );
      }

      this.recordingWarmupFinalized = true;
    } catch (error) {
      this.allowPrecountClicks = true;
      throw error;
    }
  }

  /**
   * Abort an in-flight commitRecordingStart wait (e.g. precount overlay cancel
   * after 4→1 but before capture starts).
   */
  abortRecordingStartCommit(): void {
    this.recordingStartAborted = true;
  }

  /**
   * Finalize warmup if needed, optionally wait for a precount downbeat, then
   * start metronome/monitor and recorder together (no heavy work between them).
   */
  async commitRecordingStart(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
    monitorStartTime?: number;
    nextBeatDeadlineMs?: number;
    silentLayerId?: string;
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    if (this.recordingStartInFlight) {
      return this.recordingStartInFlight;
    }

    const commitPromise = this.performCommitRecordingStart(options);
    this.recordingStartInFlight = commitPromise;
    try {
      await commitPromise;
    } finally {
      if (this.recordingStartInFlight === commitPromise) {
        this.recordingStartInFlight = null;
      }
    }
  }

  private async performCommitRecordingStart(options?: {
    monitorMix?: boolean;
    duckMonitorMix?: boolean;
    monitorStartTime?: number;
    nextBeatDeadlineMs?: number;
    silentLayerId?: string;
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    this.recordingStartAborted = false;

    const monitorMix = options?.monitorMix ?? this.preparedMonitorMix;
    const monitorStartTime = options?.monitorStartTime ?? 0;
    this.monitorSilentLayerId = options?.silentLayerId ?? null;
    if (options?.duckMonitorMix != null) {
      this.preparedDuckMonitorMix = Boolean(monitorMix && options.duckMonitorMix);
    }

    await this.finalizeRecordingWarmup({
      monitorMix,
      duckMonitorMix: this.preparedDuckMonitorMix,
    });

    if (this.recordingStartAborted) {
      throw new RecordingStartAbortedError();
    }

    if (!this.recorder || !this.context) {
      this.recordingPrepared = false;
      this.recordingWarmupFinalized = false;
      throw new Error('Recording warmup incomplete');
    }

    const context = this.context;
    const deadlineMs = options?.nextBeatDeadlineMs;
    const throwIfAborted = () => {
      if (this.recordingStartAborted) {
        this.invalidateAndStopSources();
        throw new RecordingStartAbortedError();
      }
    };

    const armAudibleOutput = (startWhen: number) => {
      // End precount click gate before arm. Arm/monitor mix stopMetronomeSources
      // themselves; do not stop earlier or the trailing "1" click is muted.
      this.allowPrecountClicks = false;
      this.applyPreparedMonitorMixGain();
      if (monitorMix) {
        this.startMonitorMixAt(monitorStartTime, startWhen);
      } else if (this.metronomeSettings.enabled) {
        this.armMetronomeForRecording(monitorStartTime, startWhen);
      }
    };

    let startWhen: number;

    if (deadlineMs != null) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs > 0) {
        // Precompute audio-clock downbeat, arm early so beat 0 cannot be dropped,
        // then start the recorder on the downbeat (not at arm time).
        const targetWhen = context.currentTime + remainingMs / 1000;
        startWhen = targetWhen;

        const oneTailDeadline = Date.now() + PRECOUNT_ONE_TAIL_MS;
        while (Date.now() < oneTailDeadline) {
          throwIfAborted();
          const remaining = oneTailDeadline - Date.now();
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(20, Math.max(1, remaining)))
          );
        }
        throwIfAborted();

        // Waits can overrun the precomputed downbeat — re-clamp like runPlay.
        startWhen = Math.max(startWhen, context.currentTime + RECORDING_SCHEDULE_LEAD);
        armAudibleOutput(startWhen);

        const recorderWakeAtMs = deadlineMs - RECORDING_RECORDER_WAKE_LEAD_SEC * 1000;
        while (Date.now() < recorderWakeAtMs) {
          throwIfAborted();
          const remaining = recorderWakeAtMs - Date.now();
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(20, Math.max(1, remaining)))
          );
        }
        throwIfAborted();
      } else {
        if (__DEV__ && remainingMs < -50) {
          console.log(
            `[audio] recording start missed downbeat by ${Math.round(-remainingMs)}ms; starting now`
          );
        }
        // Do not await rAF here — it can stall indefinitely when interactions
        // are busy. Overlay dismiss + yield lives in runPrecount.
        startWhen = context.currentTime + RECORDING_SCHEDULE_LEAD;
        armAudibleOutput(startWhen);
      }
    } else {
      startWhen = context.currentTime + RECORDING_SCHEDULE_LEAD;
      armAudibleOutput(startWhen);
    }

    throwIfAborted();
    if (!this.recorder) {
      this.invalidateAndStopSources();
      throw new RecordingStartAbortedError();
    }

    const startResult = this.recorder.start();

    if (startResult.status === 'error') {
      this.recorder.clearOnAudioReady();
      this.recorder = null;
      this.recordingPrepared = false;
      this.recordingWarmupFinalized = false;
      this.monitorSilentLayerId = null;
      this.invalidateAndStopSources();
      throw new Error(startResult.message);
    }

    this.recordingPrepared = false;
    this.recordingWarmupFinalized = false;
    this.recordingInterrupted = false;
    this.refreshActiveRecordingSampleRate();
    this.setRecordingInterruptionObservation(true);

    this.emit({
      isRecording: true,
      recordingDuration: 0,
      recordingPeaks: [],
      monitorMixActive: monitorMix,
      monitorMixReady: true,
      isPlaying: false,
      currentTime: monitorStartTime,
    });
    // 150ms balances live waveform growth vs JS wakeups on long stacked takes.
    this.recordingTimer = setInterval(() => {
      this.emitRecordingProgress();
    }, 150);

    if (monitorMix && this.playbackContextStartWhen > 0) {
      const sessionId = this.activePlaybackSessionId;
      this.startPlaybackTimer(sessionId, context);
    }

    const session = getSession();
    if (session) {
      // Isolated from capture — Live Activity Allow UI must never abort a live take.
      try {
        startRecordingLiveActivity(session);
      } catch (error) {
        if (__DEV__) {
          console.warn('[MemoAudioEngine] Live Activity start failed; capture continues', error);
        }
      }
    }
  }

  async cancelPreparedRecording(): Promise<void> {
    this.recordingStartAborted = true;

    if (this.state.isRecording) {
      return;
    }

    // Do not await recordingStartInFlight here — abort flag lets commit reject;
    // awaiting can nest/deadlock when callers cancel from commit error paths.

    if (this.recordingPrepareInFlight) {
      try {
        await this.recordingPrepareInFlight;
      } catch {
        // Prepare may have failed; still clear any partial recorder.
      }
    }

    if (this.recorder) {
      try {
        this.recorder.clearOnAudioReady();
        this.recorder.stop();
      } catch {
        // Recorder may not have been started.
      }
      this.recorder = null;
    }

    this.recordingPeaksBuffer = [];
    this.recordingPrepared = false;
    this.recordingWarmupFinalized = false;
    this.preparedMonitorMix = false;
    this.clearMonitorMixDuck();
    this.monitorSilentLayerId = null;
    this.recordingPlaybackBuffers.clear();
    this.allowPrecountClicks = true;
    this.recordingCueOutputRoute = 'wired';
    this.clearRecordingSampleRateState();
    this.invalidateAndStopSources();
  }

  async cancelRecording(): Promise<void> {
    if (this.state.isRecording) {
      this.clearRecordingTimer();
      this.setRecordingInterruptionObservation(false);
      if (this.recorder) {
        this.recorder.clearOnAudioReady();
        this.recorder.stop();
        this.recorder = null;
      }
      this.recordingPeaksBuffer = [];
      this.recordingPrepared = false;
      this.recordingWarmupFinalized = false;
      this.preparedMonitorMix = false;
      this.clearMonitorMixDuck();
      this.monitorSilentLayerId = null;
      this.recordingPlaybackBuffers.clear();
      this.allowPrecountClicks = true;
      this.recordingCueOutputRoute = 'wired';
      this.clearRecordingSampleRateState();
      await this.resetPlaybackGraph();
      await this.configureForPlayback();
      this.recordingInterrupted = false;
      this.emit({
        isRecording: false,
        recordingDuration: 0,
        recordingPeaks: [],
        monitorMixActive: false,
        monitorMixReady: false,
      });
      clearSession();
      void endMemoLiveActivity();
      return;
    }

    await this.cancelPreparedRecording();
  }

  async stopRecorderCapture(): Promise<RecordingCaptureResult> {
    if (!this.recorder) {
      throw new Error('No active recording');
    }

    this.stopCaptureInFlight = true;
    try {
      this.clearRecordingTimer();
      this.setRecordingInterruptionObservation(false);
      this.emitRecordingProgress();
      const trimmed = this.trimRawPeaksToDuration(
        this.recordingPeaksBuffer,
        this.recorder.getCurrentDuration()
      );
      const peaks = this.toAbsolutePeaks(trimmed);
      this.recorder.clearOnAudioReady();
      const result = this.recorder.stop();
      this.recorder = null;
      this.recordingPeaksBuffer = [];

      const wasMonitorMix = this.state.monitorMixActive;
      // Capture before clearMetronomeOnlyState — metro-only first takes need cue compensation.
      const wasSoftwareMonitoredCue = wasMonitorMix || this.metronomeOnlyActive;
      const cueOutputRoute = this.recordingCueOutputRoute;
      const usedWavFormat = this.recordingUsedWavFormat;
      this.stopMetronomeSources();
      this.stopActiveSources();
      this.recordingPlaybackBuffers.clear();
      this.clearMetronomeOnlyState();
      this.clearMonitorMixDuck();
      this.playbackContextStartWhen = 0;
      this.monitorMixPlannedUntil = 0;
      this.resetPlaybackRateClock();
      this.clearPlaybackTimer();
      this.clearRecordingSampleRateState();
      this.monitorSilentLayerId = null;
      this.allowPrecountClicks = true;
      this.recordingInterrupted = false;
      this.recordingCueOutputRoute = 'wired';
      this.emit({
        isRecording: false,
        recordingDuration: 0,
        recordingPeaks: [],
        monitorMixActive: false,
        monitorMixReady: false,
      });

      if (result.status === 'error') {
        throw new Error(result.message);
      }

      const path = result.paths[0];
      if (!path) {
        throw new Error('Recording file was not written. Try recording again.');
      }

      return {
        path,
        duration: result.duration,
        peaks,
        wasMonitorMix,
        wasSoftwareMonitoredCue,
        cueOutputRoute,
        recorderDuration: result.duration,
        usedWavFormat,
      };
    } finally {
      this.stopCaptureInFlight = false;
    }
  }

  async finalizeRecordingAfterStop(
    capture: RecordingCaptureResult,
    options?: { deferPlaybackSetup?: boolean }
  ): Promise<{ path: string; duration: number; peaks: number[] }> {
    let path = capture.path;
    let duration = capture.duration;
    const recorderDuration = capture.recorderDuration;

    assertRecordingFilePresent(path);

    // Happy path: our 44.1k WAV + dense live peaks — skip full-file decode.
    const canSkipDecode =
      capture.usedWavFormat &&
      recorderDuration > 0.05 &&
      shouldUseCapturedPeaks(capture.peaks, recorderDuration);

    if (!canSkipDecode) {
      const decoded = await decodeAudioData(path);
      const needsNormalize = recordingNeedsNormalize(
        decoded.sampleRate,
        decoded.duration,
        recorderDuration,
        RECORDING_SAMPLE_RATE
      );

      if (needsNormalize) {
        try {
          const normalized = await normalizeRecordingFile(path, RECORDING_SAMPLE_RATE, {
            recordedDuration: recorderDuration,
          });
          path = normalized.path;
          duration = normalized.duration;
        } catch (error) {
          if (__DEV__) {
            console.warn(
              '[MemoAudioEngine] recording normalize failed, using raw file',
              error
            );
          }
          duration = decoded.duration;
        }
      } else {
        duration = decoded.duration;
      }
    }

    const deferPlaybackSetup =
      options?.deferPlaybackSetup ?? this.isAppInBackground();

    if (capture.wasMonitorMix) {
      this.stopPlayback();
    }

    if (deferPlaybackSetup) {
      this.deferredPlaybackSetup = true;
    } else {
      // Keep decoded prior layers warm across stack save → reload.
      await this.resetPlaybackGraph({
        preserveLayerBuffers: this.loadedLayers.length > 0,
      });
      await this.configureForPlayback();
    }

    void endMemoLiveActivity();

    return { path, duration, peaks: capture.peaks };
  }

  async stopRecording(options?: { deferPlaybackSetup?: boolean }): Promise<{
    path: string;
    duration: number;
    peaks: number[];
  }> {
    const capture = await this.stopRecorderCapture();
    return this.finalizeRecordingAfterStop(capture, options);
  }

  async play(options?: { loopRestart?: boolean }): Promise<void> {
    this.stopMetronomePreview();
    // Only coalesce onto a still-valid in-flight play. pause()/seek bump playRequestId
    // without clearing playInFlight; coalescing onto that cancelled promise would no-op.
    if (
      this.playInFlight &&
      !options?.loopRestart &&
      this.playInFlightRequestId === this.playRequestId
    ) {
      return this.playInFlight;
    }

    const requestId = ++this.playRequestId;

    if (this.playInFlight) {
      try {
        await this.playInFlight;
      } catch {
        // Ignore errors from a superseded/cancelled play.
      }
      if (requestId !== this.playRequestId) {
        // A newer play() superseded this request.
        return;
      }
    }

    const playPromise = this.runPlay(requestId);
    this.playInFlight = playPromise;
    this.playInFlightRequestId = requestId;
    try {
      await playPromise;
    } finally {
      if (this.playInFlight === playPromise) {
        this.playInFlight = null;
      }
    }
  }

  private async runPlay(requestId: number): Promise<void> {
    if (this.loadedLayers.length === 0) {
      return;
    }
    if (this.state.isRecording) {
      return;
    }

    try {
      const context = await this.ensureContext();
      if (requestId !== this.playRequestId || this.state.isRecording) {
        return;
      }
      // Loop wrap already stopped sources; still invalidate session for a clean restart.
      this.invalidateAndStopSources();

      const timelineDuration = this.state.duration;
      const bounds = this.getPlaybackBounds(timelineDuration);
      let endAt = bounds.end;
      let startAt = Math.max(bounds.start, this.state.currentTime);
      if (
        this.state.loopEnabled &&
        this.hasValidLoop() &&
        this.state.currentTime >= bounds.end
      ) {
        // After the loop: play from playhead to memo end; do not snap back
        startAt = this.state.currentTime;
        endAt = this.getPlaybackEnd(timelineDuration);
      } else if (this.isAtPlaybackEnd(timelineDuration)) {
        startAt = bounds.start;
        this.emit({ currentTime: startAt });
      }

      const playDuration = endAt - startAt;
      if (playDuration <= PLAYBACK_END_TOLERANCE) {
        return;
      }

      this.playbackStartAt = startAt;
      this.playbackEndAt = endAt;
      const sessionId = this.activePlaybackSessionId;
      this.layerPlaybackDryOnly = false;

      const planSpecs = this.buildPlaybackPlans(startAt, endAt);
      if (planSpecs.length === 0) {
        return;
      }

      const uniqueLayers = new Map<string, LoadedLayer>();
      for (const plan of planSpecs) {
        if (!uniqueLayers.has(plan.layer.id)) {
          uniqueLayers.set(plan.layer.id, plan.layer);
        }
      }
      const buffersByLayerId = new Map<string, AudioBuffer>();
      await Promise.all(
        [...uniqueLayers.values()].map(async (layer) => {
          const buffer = await this.getLayerBuffer(context, layer);
          buffersByLayerId.set(layer.id, buffer);
        })
      );

      const plans = planSpecs.map((plan) => {
        const buffer = buffersByLayerId.get(plan.layer.id);
        if (!buffer) {
          return null;
        }
        const resolved = resolvePlanAgainstBuffer(plan, buffer.duration);
        if (!resolved) {
          return null;
        }

        return {
          layer: plan.layer,
          buffer,
          playbackEffects: resolved.playbackEffects,
          bufferOffset: resolved.bufferOffset,
          delay: resolved.delay,
          layerPlayLength: resolved.layerPlayLength,
        };
      });

      // Another play()/stop may have started during buffer decode.
      if (
        requestId !== this.playRequestId ||
        sessionId !== this.activePlaybackSessionId ||
        this.state.isRecording
      ) {
        return;
      }

      const resolvedPlans = plans.filter(
        (plan): plan is LayerPlaybackPlan => plan !== null
      );

      if (resolvedPlans.length === 0) {
        return;
      }

      // Re-apply effects from loaded state onto persisted channels/buses.
      this.syncMixGraph(context);

      const { ready, pending } = partitionPlansByHorizon(
        resolvedPlans,
        PLAYBACK_SCHEDULE_CHUNK_SEC
      );
      this.pendingLayerPlaybacks = pending;

      let when = context.currentTime + playbackScheduleLeadSec(ready.length);
      this.playbackContextStartWhen = when;
      this.playbackRate = 1;
      this.playbackRateAnchorContextTime = when;
      this.playbackRateAnchorPosition = startAt;

      let scheduledSources = 0;
      for (const plan of ready) {
        scheduledSources += this.scheduleResolvedLayerPlan(context, plan);
      }

      if (scheduledSources === 0) {
        this.playbackContextStartWhen = 0;
        this.resetPlaybackRateClock();
        this.pendingLayerPlaybacks = [];
        return;
      }

      // If arming overran the lead, re-anchor the UI clock to audible start.
      if (context.currentTime > when) {
        when = context.currentTime;
        this.playbackContextStartWhen = when;
        this.playbackRateAnchorContextTime = when;
        this.playbackRateAnchorPosition = startAt;
      }

      this.scheduleMetronome(context, startAt, endAt, when);
      this.startPlaybackTimer(sessionId, context);
      this.playbackInterrupted = false;

      if (!this.state.isRecording) {
        // JS must observe so we sync pause UI; native then skips onInterruptionEnd.
        this.setPlaybackInterruptionObservation(true);
      }

      if (
        !this.state.isRecording &&
        this.state.memoId &&
        this.state.memoTitle
      ) {
        // Update-in-place on loop wraps; start only when no activity exists.
        ensurePlaybackLiveActivity({
          memoId: this.state.memoId,
          memoTitle: this.state.memoTitle,
          playbackOffset: startAt,
        });
      }
    } catch (error) {
      this.invalidateAndStopSources();
      this.emit({ isPlaying: false });
      if (!this.state.isRecording) {
        this.setPlaybackInterruptionObservation(false);
        void endMemoLiveActivity();
      }
      throw error;
    }
  }

  pause(): void {
    // Always cancel in-flight play(); isPlaying stays false until sources schedule.
    this.playRequestId += 1;
    if (!this.state.isPlaying) {
      if (!this.state.isRecording) {
        this.invalidateAndStopSources();
        this.setPlaybackInterruptionObservation(false);
      }
      return;
    }
    const pausedAt = this.context
      ? this.getElapsedPlaybackTime(this.context)
      : this.state.currentTime;
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: pausedAt });
    if (!this.state.isRecording) {
      this.setPlaybackInterruptionObservation(false);
      void endMemoLiveActivity();
    }
  }

  togglePlayback(): Promise<void> {
    if (this.state.isPlaying) {
      this.pause();
      return Promise.resolve();
    }

    if (this.isAtPlaybackEnd()) {
      const bounds = this.getPlaybackBounds(this.state.duration);
      this.emit({ currentTime: bounds.start });
    } else if (this.state.loopEnabled && this.hasValidLoop()) {
      const bounds = this.getPlaybackBounds(this.state.duration);
      // Press-play with playhead before/inside the loop → start at loop start.
      // After the loop: leave playhead alone (play() continues to memo end).
      if (
        this.state.currentTime < bounds.end &&
        this.state.currentTime !== bounds.start
      ) {
        this.emit({ currentTime: bounds.start });
      }
    }

    return this.play();
  }

  seek(time: number): void {
    const bounds = this.getPlaybackBounds(this.state.duration);
    const minTime =
      this.state.loopEnabled && this.hasValidLoop() ? bounds.start : this.state.trimStart;
    const maxTime =
      this.state.loopEnabled && this.hasValidLoop()
        ? bounds.end
        : this.state.trimEnd || this.state.duration;
    const clamped = Math.max(minTime, Math.min(time, maxTime));
    const wasPlaying = this.state.isPlaying;
    this.invalidateAndStopSources();
    this.emit({ currentTime: clamped, isPlaying: false });
    if (wasPlaying) {
      void this.play();
    }
  }

  /**
   * Update playhead position while paused without tearing down sources.
   * While playing, falls back to seek() (stop + resume).
   */
  setPlaybackTime(time: number): void {
    if (this.state.isPlaying) {
      this.seek(time);
      return;
    }
    const bounds = this.getPlaybackBounds(this.state.duration);
    const minTime =
      this.state.loopEnabled && this.hasValidLoop() ? bounds.start : this.state.trimStart;
    const maxTime =
      this.state.loopEnabled && this.hasValidLoop()
        ? bounds.end
        : this.state.trimEnd || this.state.duration;
    const clamped = Math.max(minTime, Math.min(time, maxTime));
    if (clamped === this.state.currentTime) {
      return;
    }
    this.emit({ currentTime: clamped });
  }

  skip(seconds: number): void {
    this.seek(this.state.currentTime + seconds);
  }

  isMetronomePreviewActive(): boolean {
    return this.previewActive;
  }

  async startMetronomePreview(settings: MetronomeSettings): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    if (this.previewActive) {
      await this.resyncMetronomePreview(settings);
      return;
    }

    this.previewActive = true;
    this.previewSettings = settings;

    if (!this.previewContext) {
      this.previewContext = await this.createAudioContextAtRate(
        this.getPlaybackContextSampleRate()
      );
      this.previewGain = this.previewContext.createGain();
      this.previewGain.connect(this.previewContext.destination);
    }

    if (this.previewContext.state === 'suspended') {
      await this.previewContext.resume();
    }

    this.previewGain!.gain.value = settings.volume / 100;
    this.previewStartMs = Date.now();
    this.previewTimelineOrigin = 0;
    this.previewScheduledUntil = 0;
    this.previewAudioOrigin = this.previewContext.currentTime + 0.05;

    this.extendMetronomePreviewSchedule();

    this.previewExtendTimer = setInterval(() => {
      if (this.previewActive) {
        this.extendMetronomePreviewSchedule();
      }
    }, 2000);
  }

  stopMetronomePreview(): void {
    if (!this.previewActive) {
      return;
    }
    this.previewActive = false;
    if (this.previewExtendTimer) {
      clearInterval(this.previewExtendTimer);
      this.previewExtendTimer = null;
    }
    this.stopPreviewSources();
  }

  private stopPreviewSources(): void {
    for (const source of this.previewSources) {
      this.stopSource(source);
    }
    this.previewSources = [];
  }

  private async resyncMetronomePreview(settings: MetronomeSettings): Promise<void> {
    if (!this.previewActive || !this.previewContext) {
      return;
    }
    this.stopPreviewSources();
    this.previewSettings = settings;
    if (this.previewGain) {
      this.previewGain.gain.value = settings.volume / 100;
    }
    const elapsed = (Date.now() - this.previewStartMs) / 1000;
    this.previewTimelineOrigin = elapsed;
    this.previewScheduledUntil = elapsed;
    this.previewAudioOrigin = this.previewContext.currentTime + 0.05;
    this.extendMetronomePreviewSchedule();
  }

  private extendMetronomePreviewSchedule(): void {
    if (!this.previewActive || !this.previewContext || !this.previewGain) {
      return;
    }

    const timelineNow = (Date.now() - this.previewStartMs) / 1000;
    const scheduleFrom = this.previewScheduledUntil;
    const scheduleTo = Math.max(scheduleFrom, timelineNow) + METRONOME_SCHEDULE_CHUNK_SEC;
    if (scheduleTo <= scheduleFrom + 0.001) {
      return;
    }

    const settings = {
      ...normalizeMetronomeSettings(this.previewSettings),
      enabled: true,
    };
    const startWhen =
      this.previewAudioOrigin + (scheduleFrom - this.previewTimelineOrigin);
    const sources = scheduleMetronomeClicks(
      this.previewContext,
      this.previewGain,
      settings,
      scheduleFrom,
      scheduleTo,
      startWhen
    );
    this.previewSources.push(...sources);
    for (const source of sources) {
      source.onEnded = () => {
        const index = this.previewSources.indexOf(source);
        if (index >= 0) {
          this.previewSources.splice(index, 1);
        }
      };
    }
    this.previewScheduledUntil = scheduleTo;
  }
}

export const memoAudioEngine = new MemoAudioEngine();
