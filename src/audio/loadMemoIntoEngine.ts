import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { getMemoMetronomeSettings } from '@/src/storage/types';

export async function loadMemoIntoEngine(
  engine: MemoAudioEngine,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  const { layers, duration, trimStart, trimEnd } = getMemoPlaybackTimeline(memo);
  await engine.loadMemo(
    memo.id,
    layers,
    trimStart,
    trimEnd,
    duration,
    memo.loopStart ?? 0,
    memo.loopEnd ?? 0,
    memo.loopEnabled ?? false
  );
  if (seekTime !== undefined) {
    engine.seek(seekTime);
  }
  engine.setMetronome(getMemoMetronomeSettings(memo));
}
