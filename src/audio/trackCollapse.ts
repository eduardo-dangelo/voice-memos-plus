/** Fixed header height for a collapsed track lane — matches expanded region header. */
export const COLLAPSED_TRACK_HEIGHT = 18;

export type ComputeAccordionCollapsedIdsInput = {
  playableLayerIds: readonly string[];
  activeLayerId: string | null;
  nonCollapsibleIds?: ReadonlySet<string>;
};

/**
 * When accordion is on, returns layer IDs that should be collapsed.
 * Only the active selection stays expanded.
 */
export function computeAccordionCollapsedIds({
  playableLayerIds,
  activeLayerId,
  nonCollapsibleIds,
}: ComputeAccordionCollapsedIdsInput): Set<string> {
  const blocked = nonCollapsibleIds ?? new Set<string>();
  const collapsible = playableLayerIds.filter((id) => !blocked.has(id));

  if (collapsible.length === 0) {
    return new Set();
  }

  const expanded = new Set<string>();

  if (activeLayerId && collapsible.includes(activeLayerId)) {
    expanded.add(activeLayerId);
  }

  const collapsed = new Set<string>();
  for (const id of collapsible) {
    if (!expanded.has(id)) {
      collapsed.add(id);
    }
  }
  return collapsed;
}

/** Height per track row given collapse flags and vertical zoom. */
export function computeTrackHeights(
  collapsedFlags: readonly boolean[],
  waveformAreaHeight: number,
  trackZoom: number,
  minExpandedHeight = 48
): number[] {
  if (collapsedFlags.length === 0) {
    return [];
  }

  const collapsedCount = collapsedFlags.filter(Boolean).length;
  const expandedCount = collapsedFlags.length - collapsedCount;
  const collapsedTotal = collapsedCount * COLLAPSED_TRACK_HEIGHT;

  if (expandedCount === 0) {
    return collapsedFlags.map(() => COLLAPSED_TRACK_HEIGHT);
  }

  const expandedBase = Math.max(
    minExpandedHeight,
    ((waveformAreaHeight - collapsedTotal) / expandedCount) * trackZoom
  );

  return collapsedFlags.map((collapsed) =>
    collapsed ? COLLAPSED_TRACK_HEIGHT : expandedBase
  );
}

/** Cumulative Y offset for track index in a variable-height stack. */
export function trackYOffset(index: number, trackHeights: readonly number[]): number {
  let offset = 0;
  for (let i = 0; i < index && i < trackHeights.length; i++) {
    offset += trackHeights[i]!;
  }
  return offset;
}

/** Map scroll Y + focal Y to a fractional track index for variable row heights. */
export function focalTrackIndexFromScrollY(
  scrollY: number,
  focalYInTracks: number,
  trackHeights: readonly number[]
): number {
  const y = scrollY + focalYInTracks;
  if (trackHeights.length === 0) {
    return 0;
  }

  let offset = 0;
  for (let i = 0; i < trackHeights.length; i++) {
    const height = trackHeights[i]!;
    if (y < offset + height) {
      const local = height > 0 ? (y - offset) / height : 0;
      return i + local;
    }
    offset += height;
  }

  return Math.max(0, trackHeights.length - 1);
}

/** Scroll Y that preserves focal position when track heights change. */
export function scrollYForFocalTrackIndex(
  trackIndex: number,
  focalYInTracks: number,
  trackHeights: readonly number[]
): number {
  const clampedIndex = Math.max(0, Math.min(trackHeights.length - 1, Math.floor(trackIndex)));
  const localFraction = trackIndex - clampedIndex;
  const rowHeight = trackHeights[clampedIndex] ?? COLLAPSED_TRACK_HEIGHT;
  const yInContent = trackYOffset(clampedIndex, trackHeights) + localFraction * rowHeight;
  return Math.max(0, yInContent - focalYInTracks);
}
