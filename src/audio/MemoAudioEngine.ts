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
    getActiveRouteSnapshot,
    logRouteSnapshot,
    pinBuiltInMicrophone,
} from '@/src/audio/audioInputRouting';
import {
    clearReverbIrCache,
    isDelayPathActive,
    isReverbPathActive,
    type LayerEffectPathNodes,
} from '@/src/audio/layerEffectChain';
import { mergeLayerEffects, normalizeLayerEffects, type LayerEffects, type LayerEffectsChange } from '@/src/audio/layerEffects';
import { scheduleMetronomeClicks } from '@/src/audio/metronome';
import { MemoMixGraph } from '@/src/audio/memoMixGraph';
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
    endRecordingLiveActivity,
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
const PLAYBACK_END_TOLERANCE = 0.05;
const PLAYBACK_SCHEDULE_LEAD = 0.01;
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

export type EngineState = {
  memoId: string | null;
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
  private sessionMode: SessionMode = null;
  private lastOutputRouteKey = '';
  private recordingPeaksBuffer: number[] = [];
  private activeLayerPlayback = new Map<string, ActiveLayerPlayback>();
  private mixGraph = new MemoMixGraph();
  private metronomeSettings: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;
  private metronomeGain: GainNode | null = null;
  private metronomeSources: AudioBufferSourceNode[] = [];
  private deferredPlaybackSetup = false;
  private pendingEngineReload: { memo: Memo; seekTime: number } | null = null;
  private deferredSetupInFlight: Promise<void> | null = null;
  private recordingSessionPrewarmed = false;

  constructor() {
    AudioManager.addSystemEventListener('routeChange', () => {
      void this.handleRouteChange();
    });

    AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void (async () => {
          await awaitSaveInFlight();
          await this.finishDeferredPlaybackSetup();
        })();
      }
    });
  }

  private async handleRouteChange(): Promise<void> {
    if (this.state.isRecording) {
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
    if (this.context) {
      const context = this.context;
      this.context = null;
      await context.close();
    }
    this.disposeMixGraph();
    if (options?.preserveLayerBuffers) {
      this.pruneLayerBuffers();
    } else {
      this.invalidateLayerBuffers();
    }
    clearReverbIrCache();
  }

  private clearMonitorPlaybackState(): void {
    // Monitor mix state is cleared when the playback graph is reset.
  }

  private getTargetContextSampleRate(): number {
    if (this.state.isRecording && this.state.monitorMixActive) {
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

  private refreshActiveRecordingSampleRate(): void {
    this.activeRecordingSampleRate = Math.round(
      AudioManager.getDevicePreferredSampleRate()
    );
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.state.isRecording && this.state.monitorMixActive) {
      await this.configureForRecording();
    } else {
      await this.configureForPlayback();
    }

    const targetRate = this.getTargetContextSampleRate();

    if (
      this.context &&
      Math.round(this.context.sampleRate) !== targetRate
    ) {
      const stale = this.context;
      this.context = null;
      await stale.close();
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
    return normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });
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
    const elapsed = context.currentTime - this.playbackContextStartWhen;
    return Math.min(this.playbackStartAt + elapsed, this.playbackEndAt);
  }

  private startPlaybackTimer(sessionId: number, context: AudioContext): void {
    this.clearPlaybackTimer();
    let lastUiUpdateMs = 0;

    const tick = (frameMs: number) => {
      if (sessionId !== this.activePlaybackSessionId) {
        return;
      }

      const nextTime = this.getElapsedPlaybackTime(context);

      if (frameMs - lastUiUpdateMs >= PLAYBACK_UI_UPDATE_MS) {
        lastUiUpdateMs = frameMs;
        if (!this.state.isRecording) {
          this.emit({ currentTime: nextTime, isPlaying: true });
        }
      }

      if (nextTime >= this.playbackEndAt - PLAYBACK_END_TOLERANCE) {
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
    this.stopMetronomeSources();
    this.stopActiveSources();
  }

  private ensureMetronomeGain(context: AudioContext): GainNode {
    if (!this.metronomeGain) {
      const master = this.mixGraph.getMasterGain(context);
      this.metronomeGain = context.createGain();
      this.metronomeGain.gain.value = this.metronomeSettings.volume / 100;
      this.metronomeGain.connect(master);
    }
    return this.metronomeGain;
  }

  private shouldPlayMetronome(): boolean {
    if (!this.metronomeSettings.enabled) {
      return false;
    }
    if (this.state.isRecording && !this.state.monitorMixActive) {
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
    this.mixGraph.connectSourceToPath(source, path);
    source.start(startWhen, bufferOffset);
    source.stop(stopWhen);
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
      this.mixGraph.applyLayerEffects(context, layerId, nextEffects);
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

    this.mixGraph.applyLayerEffects(context, layerId, nextEffects);
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
    const plans: Omit<LayerPlaybackPlan, 'buffer'>[] = [];

    for (const layer of this.loadedLayers) {
      if (layer.duration <= 0) {
        continue;
      }

      const effects = this.getLoadedLayerEffects(layer);
      const trimOut = Math.min(effects.trimOut, layer.duration);
      const trimIn = Math.min(effects.trimIn, Math.max(0, trimOut - PLAYBACK_END_TOLERANCE));
      const playbackEffects: LayerEffects = { ...effects, trimIn, trimOut };
      const activeStart = layer.startTime + trimIn;
      const activeEnd = layer.startTime + trimOut;

      if (startAt >= activeEnd - PLAYBACK_END_TOLERANCE) {
        continue;
      }
      if (endAt <= activeStart) {
        continue;
      }

      const relativeStart = Math.max(0, startAt - activeStart);
      const bufferOffset = trimIn + relativeStart;
      const delay = Math.max(0, activeStart - startAt);
      const layerPlayStart = Math.max(startAt, activeStart);
      const layerPlayDuration = Math.min(activeEnd - layerPlayStart, endAt - layerPlayStart);

      if (layerPlayDuration <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;
      if (bufferOffset >= maxBufferOffset) {
        continue;
      }

      const layerPlayLength = Math.min(layerPlayDuration, trimOut - bufferOffset);

      plans.push({
        layer,
        playbackEffects,
        bufferOffset,
        delay,
        layerPlayLength,
      });
    }

    return plans;
  }

  private finishPlaybackNaturally(endAt: number, sessionId: number): void {
    if (sessionId !== this.activePlaybackSessionId) {
      return;
    }
    if (this.state.loopEnabled && this.hasValidLoop()) {
      this.clearPlaybackTimer();
      this.stopMetronomeSources();
      this.stopActiveSources();
      this.playbackContextStartWhen = 0;
      this.emit({ currentTime: this.state.loopStart, isPlaying: true });
      void this.play();
      return;
    }
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: endAt });
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

  private updateRecordingPeak(rawPeak: number, elapsedSec: number): void {
    const barIndex = Math.floor(
      elapsedSec * WAVEFORM_PIXELS_PER_SECOND / RECORDING_BAR_STEP
    );

    if (barIndex < 0) {
      return;
    }

    while (this.recordingPeaksBuffer.length <= barIndex) {
      this.recordingPeaksBuffer.push(0);
    }
    this.recordingPeaksBuffer[barIndex] = Math.max(
      this.recordingPeaksBuffer[barIndex] ?? 0,
      rawPeak
    );
  }

  private emitRecordingProgress(): void {
    if (!this.recorder) {
      return;
    }
    const duration = this.recorder.getCurrentDuration();
    const trimmed = this.trimRawPeaksToDuration(this.recordingPeaksBuffer, duration);
    const peaks = this.toAbsolutePeaks(trimmed);
    this.emit({ recordingDuration: duration, recordingPeaks: peaks });
  }

  async requestPermission(): Promise<boolean> {
    const status = await AudioManager.requestRecordingPermissions();
    return status === 'Granted';
  }

  private stopPlayback(): void {
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false });
  }

  async loadMemo(
    memoId: string,
    layers: LoadedLayer[],
    trimStart: number,
    trimEnd: number,
    timelineDuration: number,
    loopStart = 0,
    loopEnd = 0,
    loopEnabled = false
  ): Promise<void> {
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

    if (this.context && this.mixGraph.getChannel(layerId)) {
      this.mixGraph.applyLayerEffects(this.context, layerId, nextEffects);
      if (active) {
        active.playbackEffects = nextEffects;
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
    const monitorMix = options?.monitorMix ?? false;
    const monitorStartTime = options?.monitorStartTime ?? 0;

    const granted = await this.requestPermission();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }

    if (this.deferredPlaybackSetup || this.pendingEngineReload) {
      await this.finishDeferredPlaybackSetup();
    }

    this.clearRecordingSampleRateState();
    await this.resetPlaybackGraph({
      preserveLayerBuffers: this.loadedLayers.length > 0,
    });

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
      throw new Error(result.message);
    }

    const callbackConfig = this.getRecordingCallbackConfig();

    this.recordingPeaksBuffer = [];
    this.recorder.onAudioReady(
      {
        sampleRate: callbackConfig.sampleRate,
        bufferLength: callbackConfig.bufferLength,
        channelCount: 1,
      },
      ({ buffer }) => {
        const channelData = buffer.getChannelData(0);
        let max = 0;
        for (let i = 0; i < channelData.length; i++) {
          max = Math.max(max, Math.abs(channelData[i]));
        }
        const elapsedSec = this.recorder?.getCurrentDuration() ?? 0;
        this.updateRecordingPeak(max, elapsedSec);
      }
    );

    await this.prepareRecordingRoute();

    const startResult = this.recorder.start();

    if (startResult.status === 'error') {
      this.recorder.clearOnAudioReady();
      throw new Error(startResult.message);
    }

    this.refreshActiveRecordingSampleRate();

    this.emit({
      isRecording: true,
      recordingDuration: 0,
      recordingPeaks: [],
      monitorMixActive: monitorMix,
      monitorMixReady: !monitorMix,
      isPlaying: false,
      currentTime: monitorMix ? monitorStartTime : this.state.currentTime,
    });
    this.recordingTimer = setInterval(() => {
      this.emitRecordingProgress();
    }, 50);

    if (monitorMix) {
      await this.ensureMonitorContextReady();
      await this.beginMonitorPlayback(monitorStartTime);
    }

    const session = getSession();
    if (session) {
      startRecordingLiveActivity(session);
    }
  }

  async cancelRecording(): Promise<void> {
    if (!this.recorder) {
      return;
    }

    this.clearRecordingTimer();
    this.recorder.clearOnAudioReady();
    this.recorder.stop();
    this.recorder = null;
    this.recordingPeaksBuffer = [];

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
    void endRecordingLiveActivity();
  }

  async stopRecording(options?: { deferPlaybackSetup?: boolean }): Promise<{
    path: string;
    duration: number;
    peaks: number[];
  }> {
    if (!this.recorder) {
      throw new Error('No active recording');
    }

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
    this.clearRecordingSampleRateState();
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

    let path = result.paths[0];
    if (!path) {
      throw new Error('Recording file missing');
    }

    let duration = result.duration;
    const recorderDuration = duration;

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

    if (wasMonitorMix) {
      this.stopPlayback();
    }

    if (deferPlaybackSetup) {
      this.deferredPlaybackSetup = true;
    } else {
      await this.resetPlaybackGraph();
      await this.configureForPlayback();
    }

    void endRecordingLiveActivity();

    return { path, duration, peaks };
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
      const endAt = bounds.end;
      let startAt = Math.max(bounds.start, this.state.currentTime);
      if (
        this.state.loopEnabled &&
        this.hasValidLoop() &&
        (this.state.currentTime < bounds.start ||
          this.state.currentTime >= bounds.end - PLAYBACK_END_TOLERANCE)
      ) {
        startAt = bounds.start;
        this.emit({ currentTime: startAt });
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
        return;
      }

      this.scheduleMetronome(context, startAt, endAt, when);
      this.startPlaybackTimer(sessionId, context);
    } catch (error) {
      this.invalidateAndStopSources();
      this.emit({ isPlaying: false });
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
  }

  togglePlayback(): Promise<void> {
    if (this.state.isPlaying) {
      this.pause();
      return Promise.resolve();
    }

    if (this.isAtPlaybackEnd()) {
      const bounds = this.getPlaybackBounds(this.state.duration);
      this.emit({ currentTime: bounds.start });
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
