import {
  assessMemoPerformance,
  getPerformanceWarningMessage,
} from '@/src/audio/performanceBudget';
import type { Memo } from '@/src/storage/types';

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

export function resetPerformanceWarningState(): void {
  warnState.memoId = '';
  warnState.layers = false;
  warnState.nodes = false;
  warnState.pcm = false;
}
