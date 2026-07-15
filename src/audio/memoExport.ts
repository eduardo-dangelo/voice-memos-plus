import {
  decodeAudioData,
  OfflineAudioContext,
  type AudioBuffer,
  type AudioBufferSourceNode,
  type AudioContext,
} from 'react-native-audio-api';

import {
  clearReverbIrCache,
  isDelayPathActive,
  isReverbPathActive,
  type LayerEffectPathNodes,
} from '@/src/audio/layerEffectChain';
import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';
import { MemoMixGraph } from '@/src/audio/memoMixGraph';
import {
  buildLayerPlaybackPlans,
  getLayerEffectsForPlayback,
  getMemoExportBounds,
  PLAYBACK_END_TOLERANCE,
} from '@/src/audio/playbackPlans';
import { resampleMonoBufferFromRate } from '@/src/audio/wavUtils';
import { getMemoPlaybackTimeline } from '@/src/storage/paths';
import { hasRecording, type Memo } from '@/src/storage/types';

const EXPORT_SAMPLE_RATE = 44100;

type ResolvedPlaybackPlan = {
  layer: LoadedLayer;
  buffer: AudioBuffer;
  playbackEffects: ReturnType<typeof getLayerEffectsForPlayback>;
  bufferOffset: number;
  delay: number;
  layerPlayLength: number;
};

async function getLayerBufferForContext(
  context: OfflineAudioContext,
  layer: LoadedLayer
): Promise<AudioBuffer> {
  const decoded = await decodeAudioData(layer.path);
  const bufferRate = Math.round(decoded.sampleRate);
  const contextRate = Math.round(context.sampleRate);

  if (bufferRate === contextRate) {
    return decoded;
  }

  return resampleMonoBufferFromRate(
    decoded,
    bufferRate,
    contextRate,
    context as unknown as AudioContext
  );
}

function schedulePathSource(
  context: OfflineAudioContext,
  mixGraph: MemoMixGraph,
  path: LayerEffectPathNodes,
  buffer: AudioBuffer,
  startWhen: number,
  stopWhen: number,
  bufferOffset: number
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  mixGraph.connectSourceToPath(source, path);
  source.start(startWhen, bufferOffset);
  source.stop(stopWhen);
  return source;
}

export async function renderMemoForShare(memo: Memo): Promise<AudioBuffer> {
  if (!hasRecording(memo)) {
    throw new Error('This memo has no recorded audio.');
  }

  const timeline = getMemoPlaybackTimeline(memo);
  const { layers, duration, trimStart, trimEnd } = timeline;
  const bounds = getMemoExportBounds(trimStart, trimEnd, duration);
  const exportDuration = bounds.end - bounds.start;

  if (exportDuration <= PLAYBACK_END_TOLERANCE) {
    throw new Error('Nothing to export in the selected range.');
  }

  const numFrames = Math.max(1, Math.ceil(exportDuration * EXPORT_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext({
    numberOfChannels: 1,
    length: numFrames,
    sampleRate: EXPORT_SAMPLE_RATE,
  });

  const mixGraph = new MemoMixGraph();
  const graphContext = offlineCtx as unknown as AudioContext;

  try {
    mixGraph.syncLayers(
      graphContext,
      layers.map((layer) => ({
        id: layer.id,
        effects: getLayerEffectsForPlayback(layer),
      }))
    );

    const planSpecs = buildLayerPlaybackPlans(layers, bounds.start, bounds.end);
    const resolvedPlans: ResolvedPlaybackPlan[] = [];

    for (const plan of planSpecs) {
      const buffer = await getLayerBufferForContext(offlineCtx, plan.layer);
      const trimOut = Math.min(plan.playbackEffects.trimOut, buffer.duration);
      const trimIn = Math.min(
        plan.playbackEffects.trimIn,
        Math.max(0, trimOut - PLAYBACK_END_TOLERANCE)
      );
      const playbackEffects = { ...plan.playbackEffects, trimIn, trimOut };
      const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;

      if (plan.bufferOffset >= maxBufferOffset) {
        continue;
      }

      const layerPlayLength = Math.min(plan.layerPlayLength, trimOut - plan.bufferOffset);
      if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      resolvedPlans.push({
        layer: plan.layer,
        buffer,
        playbackEffects,
        bufferOffset: plan.bufferOffset,
        delay: plan.delay,
        layerPlayLength,
      });
    }

    if (resolvedPlans.length === 0) {
      throw new Error('No audible layers to export.');
    }

    for (const plan of resolvedPlans) {
      const channel = mixGraph.getChannel(plan.layer.id);
      if (!channel) {
        continue;
      }

      const startWhen = plan.delay;
      const stopWhen = startWhen + plan.layerPlayLength;
      const hasDelay = isDelayPathActive(plan.playbackEffects);
      const hasReverb = isReverbPathActive(plan.playbackEffects);

      schedulePathSource(
        offlineCtx,
        mixGraph,
        channel.dry,
        plan.buffer,
        startWhen,
        stopWhen,
        plan.bufferOffset
      );

      if (hasDelay && channel.delay) {
        schedulePathSource(
          offlineCtx,
          mixGraph,
          channel.delay,
          plan.buffer,
          startWhen,
          stopWhen,
          plan.bufferOffset
        );
      }

      if (hasReverb && channel.reverb) {
        schedulePathSource(
          offlineCtx,
          mixGraph,
          channel.reverb,
          plan.buffer,
          startWhen,
          stopWhen,
          plan.bufferOffset
        );
      }
    }

    return await offlineCtx.startRendering();
  } finally {
    mixGraph.dispose();
    clearReverbIrCache();
  }
}
