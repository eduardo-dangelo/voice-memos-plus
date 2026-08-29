import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import {
  layerTimelineSignature,
  type LayerTimelineEntry,
} from '@/src/audio/engineLayerTimeline';
import { runSerializedEngineLoad } from '@/src/audio/engineMemoLoadQueue';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import type { Memo } from '@/src/storage/types';
import { getMemoMetronomeSettings } from '@/src/storage/types';

export {
  layerTimelineSignature,
  loadedLayerTimelineChanged,
  type LayerTimelineEntry,
} from '@/src/audio/engineLayerTimeline';

export function engineLayersMatchMemo(engine: MemoAudioEngine, memo: Memo): boolean {
  if (engine.getState().memoId !== memo.id) {
    return false;
  }
  const { layers } = getMemoPlaybackTimeline(memo);
  return (
    layerTimelineSignature(layers) ===
    layerTimelineSignature(engine.getLoadedLayers())
  );
}

export { awaitEngineLoadIdle } from '@/src/audio/engineMemoLoadQueue';

async function performLoadMemoIntoEngine(
  engine: MemoAudioEngine,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  const { layers, duration, trimStart, trimEnd } = getMemoPlaybackTimeline(memo);
  await engine.loadMemo(
    memo.id,
    memo.title,
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

export async function syncEngineWithMemo(
  engine: MemoAudioEngine,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  await runSerializedEngineLoad(() => performLoadMemoIntoEngine(engine, memo, seekTime));
}

export async function loadMemoIntoEngine(
  engine: MemoAudioEngine,
  memo: Memo,
  seekTime?: number
): Promise<void> {
  await syncEngineWithMemo(engine, memo, seekTime);
}
