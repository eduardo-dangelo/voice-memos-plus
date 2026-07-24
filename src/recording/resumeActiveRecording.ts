import { router } from 'expo-router';

import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { getSession } from '@/src/recording/activeRecordingSession';

/**
 * When a recording is still live (warm process after unlock) but the user opened
 * the app without the Live Activity deep link, land them on the active memo.
 */
export function maybeNavigateToActiveRecording(engine: MemoAudioEngine): void {
  if (!engine.getState().isRecording) {
    return;
  }

  const session = getSession();
  if (!session) {
    return;
  }

  router.navigate({
    pathname: '/memo/[id]',
    params: { id: session.memoId },
  });
}
