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
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private playbackSessionId = 0;
  private activePlaybackSessionId = 0;
  private playbackStartAt = 0;
  private playbackEndAt = 0;
  private playbackWallClockStart = 0;
  private sessionConfigured = false;
  private peakNormalizers: number[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): EngineState {
    return this.state;
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

  private getElapsedPlaybackTime(): number {
    if (this.playbackWallClockStart <= 0) {
      return this.state.currentTime;
    }
    const elapsed = (Date.now() - this.playbackWallClockStart) / 1000;
    return Math.min(this.playbackStartAt + elapsed, this.playbackEndAt);
  }

  private invalidatePlaybackSession(): void {
    this.playbackSessionId += 1;
    this.activePlaybackSessionId = this.playbackSessionId;
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
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
    this.playbackWallClockStart = 0;
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

  private startPlaybackTimer(sessionId: number): void {
    this.clearPlaybackTimer();
    this.playbackWallClockStart = Date.now();
    this.playbackTimer = setInterval(() => {
      if (sessionId !== this.activePlaybackSessionId) {
        return;
      }
      const nextTime = this.getElapsedPlaybackTime();
      this.emit({ currentTime: nextTime, isPlaying: true });
      if (nextTime >= this.playbackEndAt - PLAYBACK_END_TOLERANCE) {
        this.finishPlaybackNaturally(this.playbackEndAt, sessionId);
      }
    }, 50);
  }

  private appendRecordingPeak(rawPeak: number): void {
    const peak = Math.max(rawPeak, 0.001);
    this.peakNormalizers.push(peak);
    const highest = Math.max(...this.peakNormalizers, 0.001);
    let nextPeaks = [...this.state.recordingPeaks, peak / highest];

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
    duration: number,
    trimStart: number,
    trimEnd: number
  ): Promise<void> {
    this.stopPlayback();
    if (this.loadedPath !== filePath) {
      this.invalidateDecodedBuffer();
    }
    this.loadedPath = filePath;
    this.emit({
      memoId,
      duration,
      trimStart,
      trimEnd,
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

    this.peakNormalizers = [];
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
    }, 100);
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
    this.peakNormalizers = [];

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
    source.start(when, startAt);
    source.stop(when + playDuration);

    this.startPlaybackTimer(sessionId);
    this.emit({ isPlaying: true, currentTime: startAt });
  }

  pause(): void {
    if (!this.state.isPlaying) {
      return;
    }
    const pausedAt = this.getElapsedPlaybackTime();
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
