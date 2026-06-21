import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioNode,
  BiquadFilterNode,
  ConvolverNode,
  DelayNode,
  GainNode,
} from 'react-native-audio-api';

import {
  dbToLinear,
  EQ_FREQUENCIES,
  syncDelayTimeMs,
  type LayerEffects,
  type ReverbPreset,
} from '@/src/audio/layerEffects';

export type LayerEffectNodes = {
  gain: GainNode;
  eqFilters: BiquadFilterNode[];
  dryGain: GainNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverbConvolver: ConvolverNode;
  reverbWet: GainNode;
};

const REVERB_DURATION: Record<Exclude<ReverbPreset, 'off'>, number> = {
  room: 0.6,
  hall: 1.8,
  plate: 1.2,
};

function createImpulseResponse(
  context: AudioContext,
  durationSec: number,
  decay: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const impulse = context.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.pow(1 - i / length, Math.max(0.5, decay));
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return impulse;
}

export function buildLayerEffectGraph(
  context: AudioContext,
  effects: LayerEffects
): LayerEffectNodes {
  const gain = context.createGain();
  const eqFilters = EQ_FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1;
    return filter;
  });

  const dryGain = context.createGain();
  const delayNode = context.createDelay(2);
  const delayFeedback = context.createGain();
  const delayWet = context.createGain();
  const reverbConvolver = context.createConvolver();
  const reverbWet = context.createGain();

  gain.connect(eqFilters[0]);
  for (let i = 0; i < eqFilters.length - 1; i += 1) {
    eqFilters[i].connect(eqFilters[i + 1]);
  }

  const postEq = eqFilters[eqFilters.length - 1];
  const delayMix = effects.delay.mix / 100;
  const reverbMix =
    effects.reverb.preset === 'off' ? 0 : Math.min(1, Math.max(0, effects.reverb.mix / 100));

  postEq.connect(dryGain);

  if (delayMix > 0) {
    postEq.connect(delayNode);
    delayNode.connect(delayWet);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
  }

  if (reverbMix > 0 && effects.reverb.preset !== 'off') {
    postEq.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    const reverbDuration =
      REVERB_DURATION[effects.reverb.preset] * Math.max(0.3, effects.reverb.decay);
    reverbConvolver.buffer = createImpulseResponse(
      context,
      reverbDuration,
      effects.reverb.decay
    );
  }

  const nodes: LayerEffectNodes = {
    gain,
    eqFilters,
    dryGain,
    delayNode,
    delayFeedback,
    delayWet,
    reverbConvolver,
    reverbWet,
  };

  applyLayerEffects(nodes, effects, context, delayMix, reverbMix);
  return nodes;
}

export function applyLayerEffects(
  nodes: LayerEffectNodes,
  effects: LayerEffects,
  context: AudioContext,
  delayMix = effects.delay.mix / 100,
  reverbMix =
    effects.reverb.preset === 'off' ? 0 : Math.min(1, Math.max(0, effects.reverb.mix / 100))
): void {
  const now = context.currentTime;
  nodes.gain.gain.setValueAtTime(dbToLinear(effects.volumeDb), now);

  effects.eq.bands.forEach((bandDb, index) => {
    nodes.eqFilters[index].gain.setValueAtTime(bandDb, now);
  });

  const delayTimeSec =
    effects.delay.sync === 'off'
      ? effects.delay.timeMs / 1000
      : syncDelayTimeMs(effects.delay.sync) / 1000;

  nodes.delayNode.delayTime.setValueAtTime(Math.min(2, Math.max(0, delayTimeSec)), now);
  nodes.delayFeedback.gain.setValueAtTime(
    Math.min(0.85, Math.max(0, effects.delay.feedback / 100)),
    now
  );
  nodes.delayWet.gain.setValueAtTime(delayMix, now);
  nodes.reverbWet.gain.setValueAtTime(reverbMix, now);
  nodes.dryGain.gain.setValueAtTime(Math.max(0, 1 - delayMix - reverbMix), now);
}

export function connectEffectOutputs(
  nodes: LayerEffectNodes,
  destination: AudioNode
): void {
  nodes.dryGain.connect(destination);
  nodes.delayWet.connect(destination);
  nodes.reverbWet.connect(destination);
}

export function connectSourceToChain(
  source: AudioBufferSourceNode,
  nodes: LayerEffectNodes
): void {
  source.connect(nodes.gain);
}

export function getEffectiveLayerTimelineDuration(effects: LayerEffects): number {
  return Math.max(0, effects.trimOut - effects.trimIn);
}
