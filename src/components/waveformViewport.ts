/** SVG rect subpath for one waveform bar (absolute coordinates). */
export function appendWaveformBarRect(
  d: string,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  return `${d}M${x} ${y}h${width}v${height}h${-width}z`;
}

export function waveformBarHeightPx(scaledPeak: number, bodyHeight: number): number {
  const maxBar = Math.max(4, bodyHeight - 8);
  if (scaledPeak <= 0.01) {
    return 2;
  }
  return Math.max(4, Math.min(maxBar, scaledPeak * maxBar));
}

/** Visible bar indices for a track given a buffered time window (seconds). */
export function getVisibleBarIndexRange(
  visibleStartSec: number,
  visibleEndSec: number,
  trackStartTime: number,
  barCount: number,
  pixelsPerSecond: number,
  barStep: number
): { startIndex: number; endIndex: number } {
  if (barCount <= 0 || pixelsPerSecond <= 0 || barStep <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const startIndex = Math.max(
    0,
    Math.floor(((visibleStartSec - trackStartTime) * pixelsPerSecond) / barStep)
  );
  const endIndex = Math.min(
    barCount,
    Math.ceil(((visibleEndSec - trackStartTime) * pixelsPerSecond) / barStep)
  );
  return { startIndex, endIndex: Math.max(startIndex, endIndex) };
}

/** Inclusive integer seconds to render as timeline markers inside a time buffer. */
export function getVisibleMarkerSeconds(
  bufferStartSec: number,
  bufferEndSec: number,
  layoutDuration: number,
  intervalSec = 1
): number[] {
  if (layoutDuration <= 0 || bufferEndSec < bufferStartSec) {
    return [];
  }
  const step = Math.max(1, Math.floor(intervalSec));
  const start = Math.max(0, Math.floor(bufferStartSec / step) * step);
  const end = Math.min(Math.ceil(layoutDuration), Math.ceil(bufferEndSec));
  if (end < start) {
    return [];
  }
  const ticks: number[] = [];
  for (let second = start; second <= end; second += step) {
    ticks.push(second);
  }
  return ticks;
}
