/** Snap a timeline time to the nearest metronome grid interval. */
export function snapTimeToGrid(time: number, interval: number, duration: number): number {
  if (!(interval > 0)) {
    return Math.max(0, Math.min(duration, time));
  }
  return Math.max(0, Math.min(duration, Math.round(time / interval) * interval));
}
