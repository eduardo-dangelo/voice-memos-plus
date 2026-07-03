import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  decodeAudioData,
  FileDirectory,
  FileFormat,
  type AudioBuffer,
  type AudioBufferSourceNode,
} from 'react-native-audio-api';

import {
  peakToAbsoluteScale,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import {
  applyLayerEffects,
  buildLayerEffectGraph,
  clearReverbIrCache,
  connectDelayPathToDestination,
  connectDryPathToDestination,
  connectReverbPathToDestination,
  connectSourceToPath,
  isDelayPathActive,
  isReverbPathActive,
  type LayerEffectGraph,
  type LayerEffectPathNodes,
} from '@/src/audio/layerEffectChain';
import { normalizeLayerEffects, mergeLayerEffects, type LayerEffects, type LayerEffectsChange } from '@/src/audio/layerEffects';

const MAX_RECORDING_PEAKS = 150;
const RECORDING_BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
const RECORDING_SAMPLE_RATE = 44100;
const RECORDING_BUFFER_LENGTH = RECORDING_SAMPLE_RATE * 0.1;
const PLAYBACK_END_TOLERANCE = 0.05;
const PLAYBACK_SCHEDULE_LEAD = 0.01;
const PLAYBACK_UI_UPDATE_MS = 50;

export type LoadedLayer = {
  id: string;
  path: string;
  startTime: number;
  duration: number;
  effects: LayerEffects;
};

type ActiveLayerPlayback = {
  layerId: string;
  graph: LayerEffectGraph;
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
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  recordingDuration: number;
  recordingPeaks: number[];
};

type Listener = (state: EngineState) => void;

const initialState: EngineState = {
  memoId: null,
  isRecording: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: false,
  recordingDuration: 0,
  recordingPeaks: [],
};

export class MemoAudioEngine {
  private state: EngineState = { ...initialState };
  private listeners = new Set<Listener>();
  private context: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private loadedLayers: LoadedLayer[] = [];
  private layerBuffers = new Map<string, AudioBuffer>();
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private playbackRafId: number | null = null;
  private playbackSessionId = 0;
  private activePlaybackSessionId = 0;
  private playbackStartAt = 0;
  private playbackEndAt = 0;
  private playbackContextStartWhen = 0;
  private sessionConfigured = false;
  private recordingPeaksBuffer: number[] = [];
  private activeLayerPlayback = new Map<string, ActiveLayerPlayback>();

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

  private emit(partial: Partial<EngineState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private async ensureSession(): Promise<void> {
    if (!this.sessionConfigured) {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
      });
      this.sessionConfigured = true;
    }
    await AudioManager.setAudioSessionActivity(true);
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
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
        this.emit({ currentTime: nextTime, isPlaying: true });
      }

      if (nextTime >= this.playbackEndAt - PLAYBACK_END_TOLERANCE) {
        this.finishPlaybackNaturally(this.playbackEndAt, sessionId);
        return;
      }

      this.playbackRafId = requestAnimationFrame(tick);
    };

    this.emit({ currentTime: this.playbackStartAt, isPlaying: true });
    this.playbackRafId = requestAnimationFrame(tick);
  }

  private stopActiveSources(): void {
    for (const source of this.sources) {
      source.onPositionChanged = null;
      source.onEnded = null;
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
      source.disconnect();
    }
    this.sources = [];
    this.activeLayerPlayback.clear();
  }

  private invalidateAndStopSources(): void {
    this.invalidatePlaybackSession();
    this.clearPlaybackTimer();
    this.playbackContextStartWhen = 0;
    this.stopActiveSources();
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

  private async getLayerBuffer(context: AudioContext, layer: LoadedLayer): Promise<AudioBuffer> {
    const cached = this.layerBuffers.get(layer.path);
    if (cached) {
      return cached;
    }
    const buffer = await decodeAudioData(layer.path);
    this.layerBuffers.set(layer.path, buffer);
    return buffer;
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

  updateLayerEffects(layerId: string, partial: LayerEffectsChange): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }

    const active = this.activeLayerPlayback.get(layerId);
    const current = this.getLoadedLayerEffects(layer);
    layer.effects = mergeLayerEffects(current, partial, layer.duration);
    const nextEffects = this.getLoadedLayerEffects(layer);

    const needsPathRestart =
      this.state.isPlaying &&
      active !== undefined &&
      (Boolean(active.graph.delay) !== isDelayPathActive(nextEffects) ||
        Boolean(active.graph.reverb) !== isReverbPathActive(nextEffects));

    if (needsPathRestart && this.context) {
      const currentTime = this.getElapsedPlaybackTime(this.context);
      this.invalidateAndStopSources();
      this.emit({ currentTime, isPlaying: false });
      void this.play();
      return;
    }

    if (active && this.context) {
      applyLayerEffects(active.graph, nextEffects, this.context);
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
    clearReverbIrCache();
    this.invalidateLayerBuffers();
    this.emit({ ...initialState });
  }

  async startRecording(): Promise<void> {
    const granted = await this.requestPermission();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }

    await this.ensureSession();
    this.stopPlayback();

    this.recorder = new AudioRecorder();
    const result = this.recorder.enableFileOutput({
      format: FileFormat.M4A,
      directory: FileDirectory.Cache,
      subDirectory: 'voice-memos-plus',
      fileNamePrefix: 'recording',
      channelCount: 1,
    });

    if (result.status === 'error') {
      throw new Error(result.message);
    }

    this.recordingPeaksBuffer = [];
    this.recorder.onAudioReady(
      {
        sampleRate: RECORDING_SAMPLE_RATE,
        bufferLength: RECORDING_BUFFER_LENGTH,
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

    const startResult = this.recorder.start();
    if (startResult.status === 'error') {
      this.recorder.clearOnAudioReady();
      throw new Error(startResult.message);
    }

    this.emit({ isRecording: true, recordingDuration: 0, recordingPeaks: [], isPlaying: false });
    this.recordingTimer = setInterval(() => {
      this.emitRecordingProgress();
    }, 50);
  }

  stopRecording(): { path: string; duration: number; peaks: number[] } {
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

    if (result.status === 'error') {
      throw new Error(result.message);
    }

    this.emit({ isRecording: false, recordingDuration: 0, recordingPeaks: [] });
    const path = result.paths[0];
    if (!path) {
      throw new Error('Recording file missing');
    }

    return { path, duration: result.duration, peaks };
  }

  async play(): Promise<void> {
    if (this.loadedLayers.length === 0 || this.state.isRecording) {
      return;
    }

    try {
      await this.ensureSession();
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
      const when = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
      this.playbackContextStartWhen = when;

      const planSpecs = this.buildPlaybackPlans(startAt, endAt);
      if (planSpecs.length === 0) {
        this.playbackContextStartWhen = 0;
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
          const activeEnd = plan.layer.startTime + trimOut;
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

      const resolvedPlans = plans.filter(
        (plan): plan is LayerPlaybackPlan => plan !== null
      );

      if (resolvedPlans.length === 0) {
        this.playbackContextStartWhen = 0;
        return;
      }

      let scheduledSources = 0;

      for (const plan of resolvedPlans) {
        const graph = buildLayerEffectGraph(context, plan.playbackEffects);

        const startWhen = when + plan.delay;
        const stopWhen = startWhen + plan.layerPlayLength;

        const schedulePath = (path: LayerEffectPathNodes) => {
          const source = context.createBufferSource();
          source.buffer = plan.buffer;
          connectSourceToPath(source, path);
          source.start(startWhen, plan.bufferOffset);
          source.stop(stopWhen);
          this.sources.push(source);
          scheduledSources += 1;
        };

        // Separate sources per path — react-native-audio-api only processes one output per node.
        schedulePath(graph.dry);
        connectDryPathToDestination(graph, context.destination);

        if (graph.delay) {
          schedulePath(graph.delay);
          connectDelayPathToDestination(graph, context.destination);
        }

        if (graph.reverb) {
          schedulePath(graph.reverb);
          connectReverbPathToDestination(graph, context.destination);
        }

        this.activeLayerPlayback.set(plan.layer.id, { layerId: plan.layer.id, graph });
      }

      if (scheduledSources === 0) {
        this.playbackContextStartWhen = 0;
        return;
      }

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
