import type { LiveActivity } from 'expo-widgets';

import {
  beginSession,
  getSession,
  hydrateSessionFromStorage,
  type ActiveRecordingSession,
} from '@/src/recording/activeRecordingSession';
import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';

import RecordingActivity, { type RecordingActivityProps } from './RecordingLiveActivity';

const LIVE_ACTIVITY_NAME = 'RecordingActivity';

let instance: LiveActivity<RecordingActivityProps> | null = null;

function memoDeepLink(memoId: string): string {
  return `voicememosplus://memo/${memoId}`;
}

function buildRecordingProps(session: ActiveRecordingSession): RecordingActivityProps {
  return {
    memoId: session.memoId,
    memoTitle: session.memoTitle ?? 'Recording',
    activityKind: 'recording',
    recordingStartedAt: session.recordingStartedAt ?? Date.now(),
    startTime: session.startTime,
    playbackStartedAt: 0,
    playbackOffset: 0,
    mode: session.mode,
    layerId: session.layerId,
    trackColor: session.trackColor,
  };
}

function buildPlaybackProps(params: {
  memoId: string;
  memoTitle: string;
  playbackOffset: number;
}): RecordingActivityProps {
  return {
    memoId: params.memoId,
    memoTitle: params.memoTitle,
    activityKind: 'playback',
    recordingStartedAt: 0,
    startTime: 0,
    playbackStartedAt: Date.now(),
    playbackOffset: params.playbackOffset,
    mode: 'new',
    layerId: null,
    trackColor: null,
  };
}

function ensureSessionRecordingStartedAt(
  session: ActiveRecordingSession
): ActiveRecordingSession {
  if (session.recordingStartedAt) {
    return session;
  }

  const next = { ...session, recordingStartedAt: Date.now() };
  beginSession(next);
  return next;
}

async function endAllInstances(): Promise<void> {
  const instances = RecordingActivity.getInstances();
  await Promise.all(
    instances.map(async (activity) => {
      try {
        await activity.end('immediate');
      } catch {
        // Stale activity cleanup is best-effort.
      }
    })
  );
}

export async function endMemoLiveActivity(): Promise<void> {
  const active = instance;
  instance = null;

  if (!active) {
    return;
  }

  try {
    await active.end('immediate');
  } catch (error) {
    if (__DEV__) {
      console.warn('[recordingLiveActivityController] end failed', error);
    }
  }
}

export function startRecordingLiveActivity(session: ActiveRecordingSession): void {
  void endMemoLiveActivity();

  const sessionWithStart = ensureSessionRecordingStartedAt(session);
  const props = buildRecordingProps(sessionWithStart);
  instance = RecordingActivity.start(props, memoDeepLink(sessionWithStart.memoId));
}

export function startPlaybackLiveActivity(params: {
  memoId: string;
  memoTitle: string;
  playbackOffset: number;
}): void {
  if (getSession()) {
    return;
  }

  void endMemoLiveActivity();

  const props = buildPlaybackProps(params);
  instance = RecordingActivity.start(props, memoDeepLink(params.memoId));
}

export async function recoverMemoLiveActivity(engine: MemoAudioEngine): Promise<void> {
  await hydrateSessionFromStorage();

  const state = engine.getState();
  const instances = RecordingActivity.getInstances();

  if (state.isRecording) {
    const session = getSession();
    if (!session) {
      await endAllInstances();
      instance = null;
      return;
    }

    if (instances.length > 0) {
      instance = instances[0] ?? null;
      return;
    }

    startRecordingLiveActivity(session);
    return;
  }

  if (state.isPlaying && state.memoId && state.memoTitle) {
    if (instances.length > 0) {
      instance = instances[0] ?? null;
      return;
    }

    startPlaybackLiveActivity({
      memoId: state.memoId,
      memoTitle: state.memoTitle,
      playbackOffset: state.currentTime,
    });
    return;
  }

  await endAllInstances();
  instance = null;
}

export function getRecordingLiveActivityName(): string {
  return LIVE_ACTIVITY_NAME;
}
