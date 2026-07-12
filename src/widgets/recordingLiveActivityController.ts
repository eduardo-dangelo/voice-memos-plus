import type { LiveActivity } from 'expo-widgets';

import {
  beginSession,
  getSession,
  hydrateSessionFromStorage,
  type ActiveRecordingSession,
} from '@/src/recording/activeRecordingSession';

import RecordingActivity, { type RecordingActivityProps } from './RecordingLiveActivity';

const LIVE_ACTIVITY_NAME = 'RecordingActivity';

let instance: LiveActivity<RecordingActivityProps> | null = null;

function buildProps(session: ActiveRecordingSession): RecordingActivityProps {
  return {
    memoId: session.memoId,
    recordingStartedAt: session.recordingStartedAt ?? Date.now(),
    mode: session.mode,
    layerId: session.layerId,
    startTime: session.startTime,
    trackColor: session.trackColor,
  };
}

function recordingDeepLink(memoId: string): string {
  return `voicememosplus://memo/${memoId}`;
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

export function startRecordingLiveActivity(session: ActiveRecordingSession): void {
  void endRecordingLiveActivity();

  const sessionWithStart = ensureSessionRecordingStartedAt(session);
  const props = buildProps(sessionWithStart);
  instance = RecordingActivity.start(props, recordingDeepLink(sessionWithStart.memoId));
}

export async function endRecordingLiveActivity(): Promise<void> {
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

export async function recoverRecordingLiveActivity(isRecording: boolean): Promise<void> {
  await hydrateSessionFromStorage();

  const instances = RecordingActivity.getInstances();

  if (!isRecording) {
    await Promise.all(
      instances.map(async (activity) => {
        try {
          await activity.end('immediate');
        } catch {
          // Stale activity cleanup is best-effort.
        }
      })
    );
    instance = null;
    return;
  }

  const session = getSession();
  if (!session) {
    await Promise.all(
      instances.map(async (activity) => {
        try {
          await activity.end('immediate');
        } catch {
          // Stale activity cleanup is best-effort.
        }
      })
    );
    instance = null;
    return;
  }

  if (instances.length > 0) {
    instance = instances[0] ?? null;
    return;
  }

  startRecordingLiveActivity(session);
}

export function getRecordingLiveActivityName(): string {
  return LIVE_ACTIVITY_NAME;
}
