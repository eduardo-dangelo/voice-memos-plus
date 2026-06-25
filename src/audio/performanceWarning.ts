import { Alert } from 'react-native';

import {
  assessMemoPerformance,
  getPerformanceWarningMessage,
} from '@/src/audio/performanceBudget';
import type { Memo } from '@/src/storage/types';

type WarnState = {
  memoId: string;
  layers: boolean;
  nodes: boolean;
};

const warnState: WarnState = {
  memoId: '',
  layers: false,
  nodes: false,
};

export function maybeShowPerformanceWarning(memo: Memo): void {
  const assessment = assessMemoPerformance(memo);

  if (warnState.memoId !== memo.id) {
    warnState.memoId = memo.id;
    warnState.layers = false;
    warnState.nodes = false;
  }

  const showLayers = assessment.shouldWarnLayers && !warnState.layers;
  const showNodes = assessment.shouldWarnNodes && !warnState.nodes;

  if (!showLayers && !showNodes) {
    return;
  }

  if (showLayers) {
    warnState.layers = true;
  }
  if (showNodes) {
    warnState.nodes = true;
  }

  Alert.alert(
    'Performance may be reduced',
    getPerformanceWarningMessage(showLayers, showNodes),
    [{ text: 'OK' }]
  );
}

export function resetPerformanceWarningState(): void {
  warnState.memoId = '';
  warnState.layers = false;
  warnState.nodes = false;
}
