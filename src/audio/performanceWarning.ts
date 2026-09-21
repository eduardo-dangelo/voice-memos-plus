import { canMergeLayers } from '@/src/audio/mergeLayersLogic';
import {
  assessMemoPerformance,
  getPerformanceWarningMessage,
} from '@/src/audio/performanceBudget';
import type { Memo } from '@/src/storage/types';
import { getPlayableLayers } from '@/src/storage/types';

export const MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE =
  'You can merge layers to reduce file size.';

export const COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE =
  'You can collapse unselected tracks to improve app performance.';

type WarnState = {
  memoId: string;
  layers: boolean;
  nodes: boolean;
  pcm: boolean;
};

const warnState: WarnState = {
  memoId: '',
  layers: false,
  nodes: false,
  pcm: false,
};

export type PerformanceWarningResult = {
  shown: boolean;
  message: string | null;
};

export function maybeShowPerformanceWarning(memo: Memo): PerformanceWarningResult {
  const assessment = assessMemoPerformance(memo);

  if (warnState.memoId !== memo.id) {
    warnState.memoId = memo.id;
    warnState.layers = false;
    warnState.nodes = false;
    warnState.pcm = false;
  }

  if (!assessment.shouldWarnLayers) {
    warnState.layers = false;
  }
  if (!assessment.shouldWarnNodes) {
    warnState.nodes = false;
  }
  if (!assessment.shouldWarnPcm) {
    warnState.pcm = false;
  }

  const showLayers = assessment.shouldWarnLayers && !warnState.layers;
  const showNodes = assessment.shouldWarnNodes && !warnState.nodes;
  const showPcm = assessment.shouldWarnPcm && !warnState.pcm;

  if (!showLayers && !showNodes && !showPcm) {
    return { shown: false, message: null };
  }

  if (showLayers) {
    warnState.layers = true;
  }
  if (showNodes) {
    warnState.nodes = true;
  }
  if (showPcm) {
    warnState.pcm = true;
  }

  return {
    shown: true,
    message: getPerformanceWarningMessage(showLayers, showNodes, showPcm),
  };
}

/** True when acknowledging a performance warning should offer the merge tip. */
export function shouldShowMergeLayersTipAfterPerformanceAck(
  memo: Memo | null | undefined,
  isRecording: boolean,
  options?: { hideTip?: boolean }
): boolean {
  if (!memo || isRecording) {
    return false;
  }
  if (options?.hideTip) {
    return false;
  }
  return canMergeLayers(memo.layers);
}

export type CollapseTracksTipOptions = {
  activeLayerId: string | null;
  collapsedLayerIds: ReadonlySet<string>;
  hideTip?: boolean;
};

/** True when any playable layer other than the selection is already collapsed. */
export function hasCollapsedUnselectedTracks(
  memo: Memo,
  activeLayerId: string | null,
  collapsedLayerIds: ReadonlySet<string>
): boolean {
  if (memo.trackAccordionEnabled === true) {
    return true;
  }
  const playable = getPlayableLayers(memo);
  return playable.some(
    (layer) => layer.id !== activeLayerId && collapsedLayerIds.has(layer.id)
  );
}

/** True when acknowledging the merge tip should offer the collapse tip. */
export function shouldShowCollapseTracksTipAfterMergeAck(
  memo: Memo | null | undefined,
  isRecording: boolean,
  options: CollapseTracksTipOptions
): boolean {
  if (!memo || isRecording) {
    return false;
  }
  if (options.hideTip) {
    return false;
  }
  if (!canMergeLayers(memo.layers)) {
    return false;
  }
  if (
    hasCollapsedUnselectedTracks(
      memo,
      options.activeLayerId,
      options.collapsedLayerIds
    )
  ) {
    return false;
  }
  return true;
}

export function resetPerformanceWarningState(): void {
  warnState.memoId = '';
  warnState.layers = false;
  warnState.nodes = false;
  warnState.pcm = false;
}
