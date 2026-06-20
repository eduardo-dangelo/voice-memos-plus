export type Layer = {
  id: string;
  order: number;
  fileName: string;
  label: string;
  startTime: number;
  duration: number;
  waveformPeaks?: number[];
};

export type Memo = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  layers: Layer[];
};

export function getLayerEndTime(layer: Layer): number {
  return layer.startTime + layer.duration;
}

export function getMemoTimelineDuration(memo: Memo): number {
  if (memo.layers.length === 0) {
    return memo.duration;
  }
  return Math.max(memo.duration, ...memo.layers.map(getLayerEndTime));
}

export function normalizeLayers(memo: Memo): Memo {
  for (const layer of memo.layers) {
    if (layer.startTime === undefined) {
      layer.startTime = 0;
    }
    if (layer.duration === undefined) {
      layer.duration = 0;
    }
  }
  return memo;
}

export function getEffectiveDuration(memo: Memo): number {
  const end = memo.trimEnd > 0 ? memo.trimEnd : memo.duration;
  const start = memo.trimStart;
  return Math.max(0, end - start);
}

export function hasRecording(memo: Memo): boolean {
  return getMemoTimelineDuration(memo) > 0 || memo.layers.some((layer) => layer.duration > 0);
}

export function getPlayableLayers(memo: Memo): Layer[] {
  return memo.layers.filter((layer) => layer.duration > 0);
}
