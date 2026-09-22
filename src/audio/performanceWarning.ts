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

/** Session latches so plain Continue does not re-open the same tip every render. */
type TipSessionState = {
  memoId: string;
  mergeShown: boolean;
  collapseShown: boolean;
};

const tipSession: TipSessionState = {
  memoId: '',
  mergeShown: false,
  collapseShown: false,
};

function syncTipSessionMemo(memoId: string): void {
  if (tipSession.memoId === memoId) {
    return;
  }
  tipSession.memoId = memoId;
  tipSession.mergeShown = false;
  tipSession.collapseShown = false;
}

export type PerformanceWarningResult = {
  shown: boolean;
  message: string | null;
};

export function maybeShowPerformanceWarning(memo: Memo): PerformanceWarningResult {
  if (memo.hidePerformanceWarning === true) {
    return { shown: false, message: null };
  }

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

/** True when the merge-layers tip is eligible (independent of other tips). */
export function shouldShowMergeLayersTip(
  memo: Memo | null | undefined,
  isRecording: boolean
): boolean {
  if (!memo || isRecording) {
    return false;
  }
  if (memo.hideMergeLayersPerformanceTip === true) {
    return false;
  }
  return canMergeLayers(memo.layers);
}

export type CollapseTracksTipOptions = {
  activeLayerId: string | null;
  collapsedLayerIds: ReadonlySet<string>;
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

/** True when the collapse-tracks tip is eligible (independent of other tips). */
export function shouldShowCollapseTracksTip(
  memo: Memo | null | undefined,
  isRecording: boolean,
  options: CollapseTracksTipOptions
): boolean {
  if (!memo || isRecording) {
    return false;
  }
  if (memo.hideCollapseTracksPerformanceTip === true) {
    return false;
  }
  if (getPlayableLayers(memo).length < 2) {
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

export type ResolveEditorTipsInput = {
  memo: Memo;
  isRecording: boolean;
  activeLayerId: string | null;
  collapsedLayerIds: ReadonlySet<string>;
};

export type ResolveEditorTipsResult =
  | { kind: 'performance'; message: string }
  | { kind: 'merge' }
  | { kind: 'collapse' }
  | { kind: null };

/**
 * Picks at most one tip. Priority: performance → merge → collapse.
 * Each tip is independently gated by its memo hide flag and content rules.
 * Session latches prevent re-showing the same tip after Continue in this visit.
 */
export function resolvePerformanceRelatedTips(
  input: ResolveEditorTipsInput
): ResolveEditorTipsResult {
  const { memo, isRecording, activeLayerId, collapsedLayerIds } = input;
  syncTipSessionMemo(memo.id);

  if (isRecording) {
    return { kind: null };
  }

  const performance = maybeShowPerformanceWarning(memo);
  if (performance.message) {
    return { kind: 'performance', message: performance.message };
  }

  if (
    !tipSession.mergeShown &&
    shouldShowMergeLayersTip(memo, isRecording)
  ) {
    tipSession.mergeShown = true;
    return { kind: 'merge' };
  }

  if (
    !tipSession.collapseShown &&
    shouldShowCollapseTracksTip(memo, isRecording, {
      activeLayerId,
      collapsedLayerIds,
    })
  ) {
    tipSession.collapseShown = true;
    return { kind: 'collapse' };
  }

  return { kind: null };
}

export function resetPerformanceWarningState(): void {
  warnState.memoId = '';
  warnState.layers = false;
  warnState.nodes = false;
  warnState.pcm = false;
  tipSession.memoId = '';
  tipSession.mergeShown = false;
  tipSession.collapseShown = false;
}
