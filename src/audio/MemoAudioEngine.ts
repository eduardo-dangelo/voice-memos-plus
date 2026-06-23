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
  connectDelayPathToDestination,
  connectDryPathToDestination,
  connectReverbPathToDestination,
  connectSourceToPath,
  isDelayPathActive,
  isReverbPathActive,
  type LayerEffectGraph,
} from '@/src/audio/layerEffectChain';
import { normalizeLayerEffects, mergeLayerEffects, type LayerEffects } from '@/src/audio/layerEffects';

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

export type EngineState = {
  memoId: string | null;
  isRecording: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
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

  private getPlaybackEnd(timelineDuration: number): number {
    const trimEnd = this.state.trimEnd > 0 ? this.state.trimEnd : timelineDuration;
    return Math.min(trimEnd, timelineDuration);
  }

  private isAtPlaybackEnd(timelineDuration?: number): boolean {
    const endAt = timelineDuration !== undefined
      ? this.getPlaybackEnd(timelineDuration)
      : this.getPlaybackEnd(this.state.duration);
    return this.state.currentTime >= endAt - PLAYBACK_END_TOLERANCE;
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

  private finishPlaybackNaturally(endAt: number, sessionId: number): void {
    if (sessionId !== this.activePlaybackSessionId) {
      return;
    }
    this.invalidateAndStopSources();
    this.emit({ isPlaying: false, currentTime: endAt });
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
    timelineDuration: number
  ): Promise<void> {
    this.stopPlayback();
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
      currentTime: trimStart,
      isPlaying: false,
    });
  }

  updateLayerEffects(layerId: string, partial: Partial<LayerEffects> & {
    reverb?: Partial<LayerEffects['reverb']>;
    delay?: Partial<LayerEffects['delay']>;
    eq?: Partial<LayerEffects['eq']>;
  }): void {
    const layer = this.loadedLayers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }

    const active = this.activeLayerPlayback.get(layerId);
    const current = normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });
    layer.effects = mergeLayerEffects(current, partial, layer.duration);
    const nextEffects = normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });

    const needsPathRestart =
      this.state.isPlaying &&
      active !== undefined &&
      ((!active.graph.delay && isDelayPathActive(nextEffects)) ||
        (!active.graph.reverb && isReverbPathActive(nextEffects)));

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
    this.emit({ duration: timelineDuration, trimEnd });
  }

  unload(): void {
    this.stopPlayback();
    this.loadedLayers = [];
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
      const endAt = this.getPlaybackEnd(timelineDuration);
      let startAt = Math.max(this.state.trimStart, this.state.currentTime);
      if (this.isAtPlaybackEnd(timelineDuration)) {
        startAt = this.state.trimStart;
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

      let scheduledSources = 0;

      for (const layer of this.loadedLayers) {
        if (layer.duration <= 0) {
          continue;
        }

        const buffer = await this.getLayerBuffer(context, layer);
        const effects = normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });
        const trimOut = Math.min(effects.trimOut, buffer.duration);
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

        const graph = buildLayerEffectGraph(context, playbackEffects);

        const layerPlayLength = Math.min(
          layerPlayDuration,
          trimOut - bufferOffset
        );

        const startWhen = when + delay;
        const stopWhen = startWhen + layerPlayLength;

        const drySource = context.createBufferSource();
        drySource.buffer = buffer;
        connectSourceToPath(drySource, graph.dry);
        connectDryPathToDestination(graph, context.destination);
        drySource.start(startWhen, bufferOffset);
        drySource.stop(stopWhen);
        this.sources.push(drySource);
        scheduledSources += 1;

        if (graph.delay) {
          const delaySource = context.createBufferSource();
          delaySource.buffer = buffer;
          connectSourceToPath(delaySource, graph.delay);
          connectDelayPathToDestination(graph, context.destination);
          delaySource.start(startWhen, bufferOffset);
          delaySource.stop(stopWhen);
          this.sources.push(delaySource);
          scheduledSources += 1;
        }

        if (graph.reverb) {
          const reverbSource = context.createBufferSource();
          reverbSource.buffer = buffer;
          connectSourceToPath(reverbSource, graph.reverb);
          connectReverbPathToDestination(graph, context.destination);
          reverbSource.start(startWhen, bufferOffset);
          reverbSource.stop(stopWhen);
          this.sources.push(reverbSource);
          scheduledSources += 1;
        }

        this.activeLayerPlayback.set(layer.id, { layerId: layer.id, graph });
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
      this.emit({ currentTime: this.state.trimStart });
    }

    return this.play();
  }

  seek(time: number): void {
    const clamped = Math.max(
      this.state.trimStart,
      Math.min(time, this.state.trimEnd || this.state.duration)
    );
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
