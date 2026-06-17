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
  private source: AudioBufferSourceNode | null = null;
  private loadedPath: string | null = null;
  private decodedPath: string | null = null;
  private decodedBuffer: AudioBuffer | null = null;
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

  private getPlaybackEnd(bufferDuration: number): number {
    const trimEnd = this.state.trimEnd > 0 ? this.state.trimEnd : bufferDuration;
    return Math.min(trimEnd, bufferDuration);
  }

  private isAtPlaybackEnd(bufferDuration?: number): boolean {
    const endAt = bufferDuration !== undefined
      ? this.getPlaybackEnd(bufferDuration)
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

  private stopActiveSource(): void {
    if (!this.source) {
      return;
    }
    this.source.onPositionChanged = null;
    this.source.onEnded = null;
    try {
      this.source.stop();
    } catch {
      // Source may already be stopped.
    }
    this.source.disconnect();
    this.source = null;
  }

  private invalidateAndStopSource(): void {
    this.invalidatePlaybackSession();
    this.clearPlaybackTimer();
    this.playbackContextStartWhen = 0;
    this.stopActiveSource();
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private invalidateDecodedBuffer(): void {
    this.decodedPath = null;
    this.decodedBuffer = null;
  }

  private async getDecodedBuffer(context: AudioContext): Promise<AudioBuffer> {
    if (!this.loadedPath) {
      throw new Error('No audio loaded');
    }
    if (this.decodedPath === this.loadedPath && this.decodedBuffer) {
      return this.decodedBuffer;
    }
    const buffer = await context.decodeAudioData(this.loadedPath);
    this.decodedPath = this.loadedPath;
    this.decodedBuffer = buffer;
    return buffer;
  }

  private finishPlaybackNaturally(endAt: number, sessionId: number): void {
    if (sessionId !== this.activePlaybackSessionId) {
      return;
    }
    this.invalidateAndStopSource();
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
    this.invalidateAndStopSource();
    this.emit({ isPlaying: false });
  }

  async loadMemo(
    memoId: string,
    filePath: string,
    _duration: number,
    trimStart: number,
    trimEnd: number
  ): Promise<void> {
    this.stopPlayback();
    if (this.loadedPath !== filePath) {
      this.invalidateDecodedBuffer();
    }
    this.loadedPath = filePath;

    const context = await this.ensureContext();
    const buffer = await this.getDecodedBuffer(context);
    const authoritativeDuration = buffer.duration;
    const trimEndResolved = trimEnd > 0
      ? Math.min(trimEnd, authoritativeDuration)
      : authoritativeDuration;

    this.emit({
      memoId,
      duration: authoritativeDuration,
      trimStart,
      trimEnd: trimEndResolved,
      currentTime: trimStart,
      isPlaying: false,
    });
  }

  unload(): void {
    this.stopPlayback();
    this.loadedPath = null;
    this.invalidateDecodedBuffer();
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
    if (!this.loadedPath || this.state.isRecording) {
      return;
    }

    await this.ensureSession();
    const context = await this.ensureContext();
    this.invalidateAndStopSource();

    const buffer = await this.getDecodedBuffer(context);
    const endAt = this.getPlaybackEnd(buffer.duration);
    let startAt = Math.max(this.state.trimStart, this.state.currentTime);
    if (this.isAtPlaybackEnd(buffer.duration)) {
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

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onPositionChanged = null;
    source.onEnded = () => {
      this.finishPlaybackNaturally(endAt, sessionId);
    };

    this.source = source;
    const when = context.currentTime + PLAYBACK_SCHEDULE_LEAD;
    this.playbackContextStartWhen = when;
    source.start(when, startAt);
    source.stop(when + playDuration);

    this.startPlaybackTimer(sessionId, context);
  }

  pause(): void {
    if (!this.state.isPlaying) {
      return;
    }
    const pausedAt = this.context
      ? this.getElapsedPlaybackTime(this.context)
      : this.state.currentTime;
    this.invalidateAndStopSource();
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
    this.invalidateAndStopSource();
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
