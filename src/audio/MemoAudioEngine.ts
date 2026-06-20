import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  FileDirectory,
  FileFormat,
  type AudioBuffer,
  type AudioBufferSourceNode,
} from 'react-native-audio-api';

const MAX_RECORDING_PEAKS = 150;
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
  private sessionPeakMax = 0.001;

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
    const buffer = await context.decodeAudioData(layer.path);
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

  private appendRecordingPeak(rawPeak: number): void {
    const peak = Math.max(rawPeak, 0.001);
    this.sessionPeakMax = Math.max(this.sessionPeakMax, peak);
    const normalizedPeak = peak / this.sessionPeakMax;
    let nextPeaks = [...this.state.recordingPeaks, normalizedPeak];

    if (nextPeaks.length > MAX_RECORDING_PEAKS) {
      const bucketSize = Math.ceil(nextPeaks.length / MAX_RECORDING_PEAKS);
      const downsampled: number[] = [];
      for (let i = 0; i < nextPeaks.length; i += bucketSize) {
        const bucket = nextPeaks.slice(i, i + bucketSize);
        downsampled.push(Math.max(...bucket));
      }
      nextPeaks = downsampled.slice(0, MAX_RECORDING_PEAKS);
    }

    this.emit({ recordingPeaks: nextPeaks });
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

    const nextPaths = layers.map((layer) => layer.path).join('|');
    const currentPaths = this.loadedLayers.map((layer) => layer.path).join('|');
    if (nextPaths !== currentPaths) {
      this.invalidateLayerBuffers();
    }

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

    this.sessionPeakMax = 0.001;
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
        this.appendRecordingPeak(max);
      }
    );

    const startResult = this.recorder.start();
    if (startResult.status === 'error') {
      this.recorder.clearOnAudioReady();
      throw new Error(startResult.message);
    }

    this.emit({ isRecording: true, recordingDuration: 0, recordingPeaks: [], isPlaying: false });
    this.recordingTimer = setInterval(() => {
      if (this.recorder) {
        this.emit({ recordingDuration: this.recorder.getCurrentDuration() });
      }
    }, 50);
  }

  stopRecording(): { path: string; duration: number; peaks: number[] } {
    if (!this.recorder) {
      throw new Error('No active recording');
    }

    const peaks = [...this.state.recordingPeaks];
    this.clearRecordingTimer();
    this.recorder.clearOnAudioReady();
    const result = this.recorder.stop();
    this.recorder = null;
    this.sessionPeakMax = 0.001;

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

      const layerEnd = layer.startTime + layer.duration;
      if (startAt >= layerEnd - PLAYBACK_END_TOLERANCE) {
        continue;
      }
      if (endAt <= layer.startTime) {
        continue;
      }

      const buffer = await this.getLayerBuffer(context, layer);
      const bufferOffset = Math.max(0, startAt - layer.startTime);
      const delay = Math.max(0, layer.startTime - startAt);
      const layerPlayStart = Math.max(startAt, layer.startTime);
      const layerPlayDuration = Math.min(layerEnd - layerPlayStart, endAt - layerPlayStart);

      if (layerPlayDuration <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(when + delay, bufferOffset);
      source.stop(when + delay + layerPlayDuration);
      this.sources.push(source);
      scheduledSources += 1;
    }

    if (scheduledSources === 0) {
      this.playbackContextStartWhen = 0;
      return;
    }

    this.startPlaybackTimer(sessionId, context);
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
