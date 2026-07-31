import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { hydrateSessionFromStorage } from '@/src/recording/activeRecordingSession';
import { recoverMemoLiveActivity } from '@/src/widgets/recordingLiveActivityController';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Cold-start gate: hydrate session, end orphan Live Activities, discard unfinished takes.
 * Auto-record must await this before arming a new capture.
 */
export function ensureRecordingBootstrapComplete(
  engine: MemoAudioEngine
): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await hydrateSessionFromStorage();
      await recoverMemoLiveActivity(engine);
    })();
  }
  return bootstrapPromise;
}
