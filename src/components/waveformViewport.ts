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
  layoutDuration: number
): number[] {
  if (layoutDuration <= 0 || bufferEndSec < bufferStartSec) {
    return [];
  }
  const start = Math.max(0, Math.floor(bufferStartSec));
  const end = Math.min(Math.ceil(layoutDuration), Math.ceil(bufferEndSec));
  if (end < start) {
    return [];
  }
  const ticks: number[] = [];
  for (let second = start; second <= end; second += 1) {
    ticks.push(second);
  }
  return ticks;
}
