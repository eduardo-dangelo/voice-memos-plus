export type LayerTimelineEntry = {
  id: string;
  path: string;
};

export function layerTimelineSignature(layers: readonly LayerTimelineEntry[]): string {
  return layers.map((layer) => `${layer.id}\0${layer.path}`).join('\n');
}

export function loadedLayerTimelineChanged(
  previous: readonly LayerTimelineEntry[],
  next: readonly LayerTimelineEntry[]
): boolean {
  return layerTimelineSignature(previous) !== layerTimelineSignature(next);
}
