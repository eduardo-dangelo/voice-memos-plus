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

import {
    assertRecordingRouteOk,
    logRouteSnapshot,
    pinBuiltInMicrophone,
} from '@/src/audio/audioInputRouting';
import {
    clearReverbIrCache,
    isDelayPathActive,
    isReverbPathActive,
    type LayerEffectPathNodes,
} from '@/src/audio/layerEffectChain';
import {
  buildLayerPlaybackPlans,
  getLayerEffectsForPlayback,
  PLAYBACK_END_TOLERANCE,
} from '@/src/audio/playbackPlans';
import { hasAnySoloActive, mergeLayerEffects, type LayerEffects, type LayerEffectsChange } from '@/src/audio/layerEffects';
import { scheduleMetronomeClicks, playMetronomeClick as scheduleOneMetronomeClick } from '@/src/audio/metronome';
import { MemoMixGraph } from '@/src/audio/memoMixGraph';
import { accumulatePeaksFromSamples } from '@/src/audio/recordingWaveformPeaks';
import {
    peakToAbsoluteScale,
    WAVEFORM_BAR_GAP,
    WAVEFORM_BAR_WIDTH,
    WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import {
    normalizeRecordingFile,
    recordingNeedsNormalize,
    resampleMonoBufferFromRate,
} from '@/src/audio/wavUtils';
import {
    awaitSaveInFlight,
    clearSession,
    getSession,
} from '@/src/recording/activeRecordingSession';
import {
    endMemoLiveActivity,
    startPlaybackLiveActivity,
    startRecordingLiveActivity,
} from '@/src/widgets/recordingLiveActivityController';
import {
    DEFAULT_METRONOME_SETTINGS,
    normalizeMetronomeSettings,
    type MetronomeSettings,
    type Memo,
} from '@/src/storage/types';
import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';

type SessionMode = 'recording' | 'playback' | null;

const MAX_RECORDING_PEAKS = 150;
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
/** Start the recorder this close to the audio downbeat after metro is already armed. */
const RECORDING_RECORDER_WAKE_LEAD_SEC = 0.005;
/** How far ahead to schedule metronome clicks while recording without monitor mix. */
const METRONOME_SCHEDULE_CHUNK_SEC = 12;
const METRONOME_SCHEDULE_EXTEND_LEAD_SEC = 2;

/** Thrown when precount cancel aborts commit during the downbeat wait. */
export class RecordingStartAbortedError extends Error {
  constructor() {
    super('Recording start aborted');
    this.name = 'RecordingStartAbortedError';
  }
}
const PLAYBACK_UI_UPDATE_MS = 50;
/** Soft clamp for DJ scrub (library allows -3…3). */
const MIN_SCRUB_PLAYBACK_RATE = -2;
const MAX_SCRUB_PLAYBACK_RATE = 2;
const PLAYBACK_RATE_EPSILON = 0.02;
/** Extend scheduled source stops while rate ≠ 1 so context-time stops do not cut early. */
const SCRUB_STOP_EXTENSION_SEC = 3600;

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
  recorderDuration: number;
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
  private activeRecordingSampleRate: number | null = null;
  private recordingUsedWavFormat = false;
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private playbackRafId: number | null = null;
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
  /** True after metronome was muted due to non-1× scrub rate. */
  private scrubMetronomeMuted = false;
  private sessionMode: SessionMode = null;
  private lastOutputRouteKey = '';
  private recordingPeaksBuffer: number[] = [];
  private lastEmittedRecordingPeakCount = -1;
  private lastEmittedRecordingPeaks: number[] = [];
  private activeLayerPlayback = new Map<string, ActiveLayerPlayback>();
  private mixGraph = new MemoMixGraph();
  private metronomeSettings: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;
  private metronomeGain: GainNode | null = null;
  private metronomeGainContext: AudioContext | null = null;
  private metronomeSources: AudioBufferSourceNode[] = [];
  private metronomeOnlyActive = false;
  private metronomeScheduledUntil = 0;
  /** False while Phase B warmup runs so precount clicks cannot rebuild a stale graph. */
  private allowPrecountClicks = true;
  private deferredPlaybackSetup = false;
  private pendingEngineReload: { memo: Memo; seekTime: number } | null = null;
  private deferredSetupInFlight: Promise<void> | null = null;
  private recordingSessionPrewarmed = false;
  private stopCaptureInFlight = false;
  private recordingStartInFlight: Promise<void> | null = null;
  private recordingPrepareInFlight: Promise<void> | null = null;
  private recordingPrepared = false;
  private recordingWarmupFinalized = false;
  private preparedMonitorMix = false;
  /** Set by abortRecordingStartCommit() to interrupt the precount downbeat wait. */
  private recordingStartAborted = false;
  /** Resampled/ready buffers for monitor-mix atomic start (path → buffer). */
  private recordingPlaybackBuffers = new Map<string, AudioBuffer>();

  constructor() {
    AudioManager.addSystemEventListener('routeChange', () => {
      void this.handleRouteChange();
    });

    AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void (async () => {
          if (this.state.isRecording) {
            return;
          }
          await awaitSaveInFlight();
          await this.finishDeferredPlaybackSetup();
        })();
      }
    });
  }

  private async handleRouteChange(): Promise<void> {
    if (this.state.isRecording) {
      if (this.stopCaptureInFlight) {
        return;
      }

      try {
        await pinBuiltInMicrophone();
        const routeSnapshot = await assertRecordingRouteOk();
        logRouteSnapshot('recording-route-change', routeSnapshot);
      } catch {
        await this.cancelRecording();
      }
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

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /**
   * Modulate live source playbackRate without restarting (DJ scrub).
   * No-ops while recording or when not in an active playback session.
   */
  setPlaybackRate(rate: number): void {
    if (this.state.isRecording || !this.state.isPlaying) {
      return;
    }
    if (!this.context || this.playbackContextStartWhen <= 0) {
      return;
    }

    const clamped = Math.max(
      MIN_SCRUB_PLAYBACK_RATE,
      Math.min(MAX_SCRUB_PLAYBACK_RATE, rate)
    );
    const next =
      Math.abs(clamped - 1) < PLAYBACK_RATE_EPSILON ? 1 : clamped;

    if (Math.abs(next - this.playbackRate) < PLAYBACK_RATE_EPSILON) {
      return;
    }

    this.anchorPlaybackClock(this.context);
    this.applyPlaybackRateToSources(next);
    this.syncMetronomeForPlaybackRate(next);
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

  scheduleDeferredEngineReload(memo: Memo, seekTime: number): void {
    this.pendingEngineReload = { memo, seekTime };
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
        await AudioManager.setAudioSessionActivity(true);
        return;
      } catch {
        this.sessionMode = null;
      }
    }

    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      // Session may already be inactive.
    }

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
      await AudioManager.setAudioSessionActivity(true);
    } catch (primaryError) {
      if (target !== 'playback') {
        throw primaryError;
      }

      try {
        await AudioManager.setAudioSessionActivity(false);
      } catch {
        // Session may already be inactive.
      }

      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
      });
      await AudioManager.setAudioSessionActivity(true);
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

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
    });
    this.sessionMode = 'recording';

    const activated = await AudioManager.setAudioSessionActivity(true);
    if (!activated) {
      throw new Error('Failed to activate audio session for recording');
    }
  }

  private async prepareRecordingRoute(): Promise<void> {
    await this.forceConfigureForRecording();
    await pinBuiltInMicrophone();
    const routeSnapshot = await assertRecordingRouteOk();
    logRouteSnapshot('recording-start', routeSnapshot);
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

  private getTargetContextSampleRate(): number {
    if (this.state.isRecording) {
      return Math.round(
        this.activeRecordingSampleRate ?? AudioManager.getDevicePreferredSampleRate()
      );
    }
    return RECORDING_SAMPLE_RATE;
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
    const context = await this.ensureContext();
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
    const targetRate = Math.round(
      this.activeRecordingSampleRate ?? AudioManager.getDevicePreferredSampleRate()
    );

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
    this.playbackStartAt = startTime;
    this.playbackEndAt = startTime;
    this.playbackContextStartWhen = startWhen;
    this.extendMetronomeOnlySchedule(startTime);
  }

  /**
   * Schedule monitor-mix playback + metronome at a fixed audio time.
   * Uses buffers warmed in finalizeRecordingWarmup — no awaits.
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
    this.scrubMetronomeMuted = false;

    const planSpecs = this.buildPlaybackPlans(playStart, endAt);
    let scheduledSources = 0;

    for (const plan of planSpecs) {
      const buffer = this.recordingPlaybackBuffers.get(plan.layer.path);
      if (!buffer) {
        continue;
      }

      const trimOut = Math.min(plan.playbackEffects.trimOut, buffer.duration);
      const trimIn = Math.min(
        plan.playbackEffects.trimIn,
        Math.max(0, trimOut - PLAYBACK_END_TOLERANCE)
      );
      const playbackEffects: LayerEffects = { ...plan.playbackEffects, trimIn, trimOut };
      const activeStart = plan.layer.startTime + trimIn;
      const relativeStart = Math.max(0, playStart - activeStart);
      const bufferOffset = trimIn + relativeStart;
      const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;

      if (bufferOffset >= maxBufferOffset) {
        continue;
      }

      const layerPlayLength = Math.min(plan.layerPlayLength, trimOut - bufferOffset);
      if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      const channel = this.mixGraph.getChannel(plan.layer.id);
      if (!channel) {
        continue;
      }

      const layerStartWhen = startWhen + plan.delay;
      const stopWhen = layerStartWhen + layerPlayLength;
      const hasDelay = isDelayPathActive(playbackEffects);
      const hasReverb = isReverbPathActive(playbackEffects);

      const drySources = [
        this.schedulePathSource(
          context,
          channel.dry,
          buffer,
          layerStartWhen,
          stopWhen,
          bufferOffset
        ),
      ];
      scheduledSources += 1;

      const delaySources: AudioBufferSourceNode[] = [];
      if (hasDelay && channel.delay) {
        delaySources.push(
          this.schedulePathSource(
            context,
            channel.delay,
            buffer,
            layerStartWhen,
            stopWhen,
            bufferOffset
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
            buffer,
            layerStartWhen,
            stopWhen,
            bufferOffset
          )
        );
        scheduledSources += 1;
      }

      this.activeLayerPlayback.set(plan.layer.id, {
        layerId: plan.layer.id,
        hasDelay,
        hasReverb,
        drySources,
        delaySources,
        reverbSources,
        buffer,
        bufferOffset,
        scheduleDelay: plan.delay,
        layerPlayLength,
        playbackEffects,
      });
    }

    if (scheduledSources === 0) {
      this.playbackContextStartWhen = 0;
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
      this.extendMetronomeOnlySchedule(playStart);
    }
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
      this.playbackContextStartWhen <= 0
    ) {
      return;
    }

    const scheduleFrom = this.metronomeScheduledUntil;
    const scheduleTo =
      Math.max(scheduleFrom, timelineNow) + METRONOME_SCHEDULE_CHUNK_SEC;
    if (scheduleTo <= scheduleFrom + 0.001) {
      return;
    }

    const context = this.context;
    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;
    const startWhen =
      this.playbackContextStartWhen + (scheduleFrom - this.playbackStartAt);
    const sources = scheduleMetronomeClicks(
      context,
      gain,
      this.metronomeSettings,
      scheduleFrom,
      scheduleTo,
      startWhen
    );
    this.metronomeSources.push(...sources);
    this.metronomeScheduledUntil = scheduleTo;
    // Keep monitor-mix end intact — only metronome-only mode extends playbackEndAt.
    if (this.activeLayerPlayback.size === 0) {
      this.playbackEndAt = scheduleTo;
    }
  }

  private clearMetronomeOnlyState(): void {
    this.metronomeOnlyActive = false;
    this.metronomeScheduledUntil = 0;
  }

  private refreshActiveRecordingSampleRate(): void {
    this.activeRecordingSampleRate = Math.round(
      AudioManager.getDevicePreferredSampleRate()
    );
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.state.isRecording) {
      await this.configureForRecording();
    } else {
      await this.configureForPlayback();
    }

    const targetRate = this.getTargetContextSampleRate();

    if (
      this.context &&
      Math.round(this.context.sampleRate) !== targetRate
    ) {
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

  /** Freeze the rate clock at the current timeline position (call before changing rate). */
  private anchorPlaybackClock(context: AudioContext): void {
    const now = context.currentTime;
    let pos: number;
    if (this.playbackRateAnchorContextTime > 0) {
      const dt = now - this.playbackRateAnchorContextTime;
      pos = this.playbackRateAnchorPosition + dt * this.playbackRate;
    } else if (this.playbackContextStartWhen > 0) {
      pos =
        this.playbackStartAt +
        Math.max(0, now - this.playbackContextStartWhen) * this.playbackRate;
    } else {
      pos = this.state.currentTime;
    }
    this.playbackRateAnchorPosition = Math.max(
      this.playbackStartAt,
      Math.min(pos, this.playbackEndAt)
    );
    this.playbackRateAnchorContextTime = now;
  }

  private resetPlaybackRateClock(): void {
    this.playbackRate = 1;
    this.playbackRateAnchorContextTime = 0;
    this.playbackRateAnchorPosition = 0;
    this.scrubMetronomeMuted = false;
  }

  private applyPlaybackRateToSources(rate: number): void {
    this.playbackRate = rate;
    for (const source of this.sources) {
      try {
        source.playbackRate.value = rate;
      } catch {
        // Source may already be stopped.
      }
    }
    if (Math.abs(rate - 1) >= PLAYBACK_RATE_EPSILON && this.context) {
      this.extendSourceStops(this.context);
    }
  }

  private extendSourceStops(context: AudioContext): void {
    const stopWhen = context.currentTime + SCRUB_STOP_EXTENSION_SEC;
    for (const source of this.sources) {
      try {
        source.stop(stopWhen);
      } catch {
        // Source may already be stopped.
      }
    }
  }

  private syncMetronomeForPlaybackRate(rate: number): void {
    if (Math.abs(rate - 1) >= PLAYBACK_RATE_EPSILON) {
      if (!this.scrubMetronomeMuted) {
        this.stopMetronomeSources();
        this.scrubMetronomeMuted = true;
      }
      return;
    }
    if (this.scrubMetronomeMuted) {
      this.scrubMetronomeMuted = false;
      this.resyncMetronome();
    }
  }

  private startPlaybackTimer(sessionId: number, context: AudioContext): void {
    this.clearPlaybackTimer();
    let lastUiUpdateMs = 0;

    const tick = (frameMs: number) => {
      if (sessionId !== this.activePlaybackSessionId) {
        return;
      }

      let nextTime = this.getElapsedPlaybackTime(context);

      // Holding reverse past the start freezes at rate 0 instead of fighting the clamp.
      if (
        nextTime <= this.playbackStartAt + PLAYBACK_END_TOLERANCE &&
        this.playbackRate < -PLAYBACK_RATE_EPSILON
      ) {
        this.anchorPlaybackClock(context);
        this.applyPlaybackRateToSources(0);
        nextTime = this.playbackStartAt;
      }

      if (frameMs - lastUiUpdateMs >= PLAYBACK_UI_UPDATE_MS) {
        lastUiUpdateMs = frameMs;
        if (!this.state.isRecording) {
          this.emit({ currentTime: nextTime, isPlaying: true });
        }
      }

      if (
        nextTime >= this.playbackEndAt - PLAYBACK_END_TOLERANCE &&
        this.playbackRate > PLAYBACK_RATE_EPSILON
      ) {
        if (this.state.isRecording) {
          // Monitor range ended while still recording — do not tear down the
          // live recording graph; chunked metronome keeps extending via progress.
          this.clearPlaybackTimer();
          return;
        }
        this.finishPlaybackNaturally(this.playbackEndAt, sessionId);
        return;
      }

      this.playbackRafId = requestAnimationFrame(tick);
    };

    if (!this.state.isRecording) {
      this.emit({ currentTime: this.playbackStartAt, isPlaying: true });
    }
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
    this.activeLayerPlayback.clear();
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
    context: AudioContext,
    startAt: number,
    endAt: number,
    startWhen: number
  ): void {
    this.stopMetronomeSources();
    if (!this.shouldPlayMetronome()) {
      return;
    }

    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;
    this.metronomeSources = scheduleMetronomeClicks(
      context,
      gain,
      this.metronomeSettings,
      startAt,
      endAt,
      startWhen
    );
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
      const active = this.activeLayerPlayback.get(layerId);
      if (active) {
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
    bufferOffset: number
  ): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (Math.abs(this.playbackRate - 1) >= PLAYBACK_RATE_EPSILON) {
      source.playbackRate.value = this.playbackRate;
    }
    this.mixGraph.connectSourceToPath(source, path);
    source.start(startWhen, bufferOffset);
    const effectiveStop =
      Math.abs(this.playbackRate - 1) >= PLAYBACK_RATE_EPSILON
        ? Math.max(stopWhen, context.currentTime + SCRUB_STOP_EXTENSION_SEC)
        : stopWhen;
    source.stop(effectiveStop);
    this.sources.push(source);
    return source;
  }

  /**
   * Hot-add or remove wet paths for one layer without restarting the session.
   * Falls back to full resync if the layer is not in the active play window.
   */
  private updateLayerWetPaths(
    context: AudioContext,
    layerId: string,
    nextEffects: LayerEffects
  ): boolean {
    const active = this.activeLayerPlayback.get(layerId);
    if (!active) {
      return false;
    }

    const wantDelay = isDelayPathActive(nextEffects);
    const wantReverb = isReverbPathActive(nextEffects);
    const delayChanged = active.hasDelay !== wantDelay;
    const reverbChanged = active.hasReverb !== wantReverb;

    if (!delayChanged && !reverbChanged) {
      this.mixGraph.applyLayerEffects(context, layerId, nextEffects, this.getAnySoloActive());
      active.playbackEffects = nextEffects;
      return true;
    }

    const channel = this.mixGraph.getChannel(layerId);
    if (!channel) {
      return false;
    }

    const elapsed = this.getElapsedPlaybackTime(context);
    const remaining = active.layerPlayLength - (elapsed - (this.playbackStartAt + active.scheduleDelay));
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
          bufferOffset
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
          bufferOffset
        )
      );
    }

    active.hasDelay = wantDelay;
    active.hasReverb = wantReverb;
    // Keep schedule metadata aligned for further hot updates.
    active.bufferOffset = bufferOffset;
    active.scheduleDelay = elapsed - this.playbackStartAt;
    active.layerPlayLength = layerPlayLength;
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
  }

  private pruneLayerBuffers(): void {
    const activePaths = new Set(this.loadedLayers.map((layer) => layer.path));
    for (const path of this.layerBuffers.keys()) {
      if (!activePaths.has(path)) {
        this.layerBuffers.delete(path);
      }
    }
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

  private async getLayerBuffer(context: AudioContext, layer: LoadedLayer): Promise<AudioBuffer> {
    const decoded = await this.getDecodedLayerBuffer(layer);
    const bufferRate = Math.round(decoded.sampleRate);
    const contextRate = Math.round(context.sampleRate);

    if (bufferRate === contextRate) {
      return decoded;
    }

    if (__DEV__) {
      console.log(
        `[audio] resampling layer for playback: ${bufferRate} Hz -> ${contextRate} Hz`
      );
    }

    return resampleMonoBufferFromRate(decoded, bufferRate, contextRate, context);
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
        void this.play();
        return;
      }
    }
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: endAt });
    if (!this.state.isRecording) {
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

  private downsampleRecordingPeaks(peaks: number[]): number[] {
    if (peaks.length <= MAX_RECORDING_PEAKS) {
      return peaks;
    }
    const bucketSize = Math.ceil(peaks.length / MAX_RECORDING_PEAKS);
    const downsampled: number[] = [];
    for (let i = 0; i < peaks.length; i += bucketSize) {
      const bucket = peaks.slice(i, i + bucketSize);
      downsampled.push(Math.max(...bucket));
    }
    return downsampled.slice(0, MAX_RECORDING_PEAKS);
  }

  private toAbsolutePeaks(raw: number[]): number[] {
    return raw.map(peakToAbsoluteScale);
  }

  private trimRawPeaksToDuration(raw: number[], duration: number): number[] {
    const barCount = Math.max(
      1,
      Math.floor(duration * WAVEFORM_PIXELS_PER_SECOND / RECORDING_BAR_STEP)
    );
    return raw.slice(0, barCount);
  }

  private emitRecordingProgress(): void {
    if (!this.recorder) {
      return;
    }
    const duration = this.recorder.getCurrentDuration();

    if (this.metronomeOnlyActive) {
      const timelineNow = this.playbackStartAt + duration;
      if (timelineNow >= this.metronomeScheduledUntil - METRONOME_SCHEDULE_EXTEND_LEAD_SEC) {
        this.extendMetronomeOnlySchedule(timelineNow);
      }
    }

    const trimmed = this.trimRawPeaksToDuration(this.recordingPeaksBuffer, duration);

    let peaks = this.lastEmittedRecordingPeaks;
    if (trimmed.length !== this.lastEmittedRecordingPeakCount) {
      peaks = this.toAbsolutePeaks(trimmed);
      this.lastEmittedRecordingPeaks = peaks;
      this.lastEmittedRecordingPeakCount = trimmed.length;
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
    this.invalidateLayerBuffers();

    this.loadedLayers = layers;
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

  /** Warm AudioContext + metronome gain so the first precount click is not delayed. */
  async primeMetronomeOutput(): Promise<void> {
    if (!this.allowPrecountClicks) {
      return;
    }
    const context = await this.getContextForPrecountClick();
    if (!this.allowPrecountClicks || !context) {
      return;
    }
    const gain = this.ensureMetronomeGain(context);
    gain.gain.value = this.metronomeSettings.volume / 100;
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
      volume: this.metronomeSettings.volume,
    });
    this.metronomeSources.push(source);
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

    const active = this.activeLayerPlayback.get(layerId);
    const current = this.getLoadedLayerEffects(layer);
    layer.effects = mergeLayerEffects(current, partial, layer.duration);
    const nextEffects = this.getLoadedLayerEffects(layer);

    const needsPathChange =
      this.state.isPlaying &&
      active !== undefined &&
      (active.hasDelay !== isDelayPathActive(nextEffects) ||
        active.hasReverb !== isReverbPathActive(nextEffects));

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
      if (this.mixGraph.getChannel(layerId)) {
        this.mixGraph.applyLayerEffects(
          this.context,
          layerId,
          nextEffects,
          this.getAnySoloActive()
        );
        if (active) {
          active.playbackEffects = nextEffects;
        }
      }
    }
  }

  updateLayerStartTime(layerId: string, startTime: number): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }
    layer.startTime = startTime;
  }

  updateLayerStartTimes(updates: Record<string, number>): void {
    for (const [layerId, startTime] of Object.entries(updates)) {
      this.updateLayerStartTime(layerId, startTime);
    }
  }

  updateTimelineDuration(timelineDuration: number): void {
    const trimEnd =
      this.state.trimEnd > 0
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
    this.emit({ duration: timelineDuration, trimEnd, loopStart, loopEnd, loopEnabled });
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
    monitorStartTime?: number;
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }
    if (this.recordingStartInFlight) {
      return this.recordingStartInFlight;
    }

    const startPromise = (async () => {
      await this.prepareRecordingStart({ monitorMix: options?.monitorMix });
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
  async prepareRecordingStart(options?: { monitorMix?: boolean }): Promise<void> {
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
  }): Promise<void> {
    if (this.state.isRecording || this.recordingPrepared) {
      return;
    }

    const monitorMix = options?.monitorMix ?? false;
    this.preparedMonitorMix = monitorMix;

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
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    // Fast path first — never await prepare in-flight if already warm (avoids hang).
    if (this.recordingWarmupFinalized && this.context && this.recorder) {
      return;
    }

    if (this.recordingPrepareInFlight) {
      await this.recordingPrepareInFlight;
    }

    if (!this.recordingPrepared || !this.recorder) {
      await this.prepareRecordingStart({ monitorMix: options?.monitorMix });
    }

    if (this.recordingWarmupFinalized && this.context && this.recorder) {
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
    monitorStartTime?: number;
    nextBeatDeadlineMs?: number;
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
    monitorStartTime?: number;
    nextBeatDeadlineMs?: number;
  }): Promise<void> {
    if (this.state.isRecording) {
      return;
    }

    this.recordingStartAborted = false;

    const monitorMix = options?.monitorMix ?? this.preparedMonitorMix;
    const monitorStartTime = options?.monitorStartTime ?? 0;

    await this.finalizeRecordingWarmup({ monitorMix });

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
      if (monitorMix) {
        this.startMonitorMixAt(monitorStartTime, startWhen);
      } else if (this.metronomeSettings.enabled) {
        this.armMetronomeForRecording(monitorStartTime, startWhen);
      }
    };

    /** Let React paint (e.g. precount Modal dismiss) before sync monitor-mix arm. */
    const yieldBeforeMonitorArm = async () => {
      if (!monitorMix) {
        return;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      throwIfAborted();
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
        // Yield before computing startWhen so arm time is not stale after the frame.
        await yieldBeforeMonitorArm();
        startWhen = context.currentTime + RECORDING_SCHEDULE_LEAD;
        armAudibleOutput(startWhen);
      }
    } else {
      await yieldBeforeMonitorArm();
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
      this.invalidateAndStopSources();
      throw new Error(startResult.message);
    }

    this.recordingPrepared = false;
    this.recordingWarmupFinalized = false;
    this.refreshActiveRecordingSampleRate();

    this.emit({
      isRecording: true,
      recordingDuration: 0,
      recordingPeaks: [],
      monitorMixActive: monitorMix,
      monitorMixReady: true,
      isPlaying: false,
      currentTime: monitorStartTime,
    });
    this.recordingTimer = setInterval(() => {
      this.emitRecordingProgress();
    }, 100);

    if (monitorMix && this.playbackContextStartWhen > 0) {
      const sessionId = this.activePlaybackSessionId;
      this.startPlaybackTimer(sessionId, context);
    }

    const session = getSession();
    if (session) {
      startRecordingLiveActivity(session);
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
    this.recordingPlaybackBuffers.clear();
    this.allowPrecountClicks = true;
    this.clearRecordingSampleRateState();
    this.invalidateAndStopSources();
  }

  async cancelRecording(): Promise<void> {
    if (this.state.isRecording) {
      this.clearRecordingTimer();
      if (this.recorder) {
        this.recorder.clearOnAudioReady();
        this.recorder.stop();
        this.recorder = null;
      }
      this.recordingPeaksBuffer = [];
      this.recordingPrepared = false;
      this.recordingWarmupFinalized = false;
      this.preparedMonitorMix = false;
      this.recordingPlaybackBuffers.clear();
      this.allowPrecountClicks = true;
      this.clearRecordingSampleRateState();
      await this.resetPlaybackGraph();
      await this.configureForPlayback();
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
      this.emitRecordingProgress();
      const trimmed = this.trimRawPeaksToDuration(
        this.recordingPeaksBuffer,
        this.recorder.getCurrentDuration()
      );
      const peaks = this.toAbsolutePeaks(this.downsampleRecordingPeaks(trimmed));
      this.recorder.clearOnAudioReady();
      const result = this.recorder.stop();
      this.recorder = null;
      this.recordingPeaksBuffer = [];

      const wasMonitorMix = this.state.monitorMixActive;
      // Capture before clearMetronomeOnlyState — metro-only first takes need cue compensation.
      const wasSoftwareMonitoredCue = wasMonitorMix || this.metronomeOnlyActive;
      this.stopMetronomeSources();
      this.stopActiveSources();
      this.clearMetronomeOnlyState();
      this.playbackContextStartWhen = 0;
      this.resetPlaybackRateClock();
      this.clearRecordingSampleRateState();
      this.allowPrecountClicks = true;
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
        throw new Error('Recording file missing');
      }

      return {
        path,
        duration: result.duration,
        peaks,
        wasMonitorMix,
        wasSoftwareMonitoredCue,
        recorderDuration: result.duration,
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
      await this.resetPlaybackGraph();
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

  async play(): Promise<void> {
    if (this.loadedLayers.length === 0) {
      return;
    }
    if (this.state.isRecording && !this.state.monitorMixActive) {
      return;
    }

    try {
      const context = await this.ensureContext();
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

      const planSpecs = this.buildPlaybackPlans(startAt, endAt);
      if (planSpecs.length === 0) {
        return;
      }

      const plans = await Promise.all(
        planSpecs.map(async (plan) => {
          const buffer = await this.getLayerBuffer(context, plan.layer);
          const trimOut = Math.min(plan.playbackEffects.trimOut, buffer.duration);
          const trimIn = Math.min(
            plan.playbackEffects.trimIn,
            Math.max(0, trimOut - PLAYBACK_END_TOLERANCE)
          );
          const playbackEffects: LayerEffects = { ...plan.playbackEffects, trimIn, trimOut };
          const activeStart = plan.layer.startTime + trimIn;
          const relativeStart = Math.max(0, startAt - activeStart);
          const bufferOffset = trimIn + relativeStart;
          const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;

          if (bufferOffset >= maxBufferOffset) {
            return null;
          }

          const layerPlayLength = Math.min(plan.layerPlayLength, trimOut - bufferOffset);
          if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
            return null;
          }

          return {
            layer: plan.layer,
            buffer,
            playbackEffects,
            bufferOffset,
            delay: plan.delay,
            layerPlayLength,
          };
        })
      );

      // Another play()/stop may have started during buffer decode.
      if (sessionId !== this.activePlaybackSessionId) {
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

      const when = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
      this.playbackContextStartWhen = when;
      this.playbackRate = 1;
      this.playbackRateAnchorContextTime = when;
      this.playbackRateAnchorPosition = startAt;
      this.scrubMetronomeMuted = false;

      let scheduledSources = 0;

      for (const plan of resolvedPlans) {
        const channel = this.mixGraph.getChannel(plan.layer.id);
        if (!channel) {
          continue;
        }

        const startWhen = when + plan.delay;
        const stopWhen = startWhen + plan.layerPlayLength;
        const hasDelay = isDelayPathActive(plan.playbackEffects);
        const hasReverb = isReverbPathActive(plan.playbackEffects);

        // Separate sources per path — react-native-audio-api only processes one output per node.
        const drySources = [
          this.schedulePathSource(
            context,
            channel.dry,
            plan.buffer,
            startWhen,
            stopWhen,
            plan.bufferOffset
          ),
        ];
        scheduledSources += 1;

        const delaySources: AudioBufferSourceNode[] = [];
        if (hasDelay && channel.delay) {
          delaySources.push(
            this.schedulePathSource(
              context,
              channel.delay,
              plan.buffer,
              startWhen,
              stopWhen,
              plan.bufferOffset
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
              startWhen,
              stopWhen,
              plan.bufferOffset
            )
          );
          scheduledSources += 1;
        }

        this.activeLayerPlayback.set(plan.layer.id, {
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
          playbackEffects: plan.playbackEffects,
        });
      }

      if (scheduledSources === 0) {
        this.playbackContextStartWhen = 0;
        this.resetPlaybackRateClock();
        return;
      }

      this.scheduleMetronome(context, startAt, endAt, when);
      this.startPlaybackTimer(sessionId, context);

      if (
        !this.state.isRecording &&
        this.state.memoId &&
        this.state.memoTitle
      ) {
        startPlaybackLiveActivity({
          memoId: this.state.memoId,
          memoTitle: this.state.memoTitle,
          playbackOffset: startAt,
        });
      }
    } catch (error) {
      this.invalidateAndStopSources();
      this.emit({ isPlaying: false });
      if (!this.state.isRecording) {
        void endMemoLiveActivity();
      }
      throw error;
    }
  }

  pause(): void {
    if (!this.state.isPlaying) {
      return;
    }
    const pausedAt = this.context
      ? this.getElapsedPlaybackTime(this.context)
      : this.state.currentTime;
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: pausedAt });
    if (!this.state.isRecording) {
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

  skip(seconds: number): void {
    this.seek(this.state.currentTime + seconds);
  }
}

export const memoAudioEngine = new MemoAudioEngine();
