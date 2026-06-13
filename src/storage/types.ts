export type Layer = {
  id: string;
  order: number;
  fileName: string;
  label: string;
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

export function getEffectiveDuration(memo: Memo): number {
  const end = memo.trimEnd > 0 ? memo.trimEnd : memo.duration;
  const start = memo.trimStart;
  return Math.max(0, end - start);
}

export function hasRecording(memo: Memo): boolean {
  return memo.duration > 0;
}
