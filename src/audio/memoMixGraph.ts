import type {
  AudioContext,
  AudioNode,
  ConvolverNode,
  DelayNode,
  GainNode,
} from 'react-native-audio-api';

import {
  applyPathInputEffects,
  buildInputEqPath,
  delayBusKey,
  isDelayPathActive,
  isReverbPathActive,
  reverbBusKey,
  syncReverbConvolver,
  type LayerEffectPathNodes,
  type LayerReverbNodes,
} from '@/src/audio/layerEffectChain';
import { syncDelayTimeMs, type LayerEffects } from '@/src/audio/layerEffects';

type DelayBus = {
  key: string;
  input: GainNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  wet: GainNode;
  refCount: number;
};

type ReverbBus = {
  key: string;
  input: GainNode;
  convolver: ConvolverNode;
  wet: GainNode;
  refCount: number;
};

export type LayerChannel = {
  layerId: string;
  input: LayerEffectPathNodes;
  dryGain: GainNode;
  delaySend: GainNode;
  reverbSend: GainNode;
  delayBusKey: string | null;
  reverbBusKey: string | null;
};

function getEffectiveReverbMix(effects: LayerEffects): number {
  if (effects.reverb.preset === 'off') {
    return 0;
  }
  return Math.min(1, Math.max(0, effects.reverb.mix / 100));
}

function applyDelayBusParams(bus: DelayBus, effects: LayerEffects, context: AudioContext): void {
  const now = context.currentTime;
  const delayTimeSec =
    effects.delay.sync === 'off'
      ? effects.delay.timeMs / 1000
      : syncDelayTimeMs(effects.delay.sync) / 1000;

  bus.delayNode.delayTime.setValueAtTime(Math.min(2, Math.max(0, delayTimeSec)), now);
  bus.delayFeedback.gain.setValueAtTime(
    Math.min(0.85, Math.max(0, effects.delay.feedback / 100)),
    now
  );
  bus.wet.gain.setValueAtTime(1, now);
}

function disconnectSend(send: GainNode): void {
  try {
    send.disconnect();
  } catch {
    // Already disconnected.
  }
}

export class MemoMixGraph {
  private masterGain: GainNode | null = null;
  private layerChannels = new Map<string, LayerChannel>();
  private delayBuses = new Map<string, DelayBus>();
  private reverbBuses = new Map<string, ReverbBus>();

  getMasterGain(context: AudioContext): GainNode {
    if (!this.masterGain) {
      this.masterGain = context.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(context.destination);
    }
    return this.masterGain;
  }

  getChannel(layerId: string): LayerChannel | undefined {
    return this.layerChannels.get(layerId);
  }

  removeLayer(layerId: string): void {
    const channel = this.layerChannels.get(layerId);
    if (!channel) {
      return;
    }

    disconnectSend(channel.delaySend);
    disconnectSend(channel.reverbSend);

    if (channel.delayBusKey) {
      this.releaseDelayBus(channel.delayBusKey);
    }
    if (channel.reverbBusKey) {
      this.releaseReverbBus(channel.reverbBusKey);
    }

    try {
      channel.input.gain.disconnect();
      channel.dryGain.disconnect();
      channel.delaySend.disconnect();
      channel.reverbSend.disconnect();
    } catch {
      // Nodes may already be torn down.
    }

    this.layerChannels.delete(layerId);
  }

  syncLayers(context: AudioContext, layers: { id: string; effects: LayerEffects }[]): void {
    const master = this.getMasterGain(context);
    const nextIds = new Set(layers.map((layer) => layer.id));

    for (const layerId of this.layerChannels.keys()) {
      if (!nextIds.has(layerId)) {
        this.removeLayer(layerId);
      }
    }

    for (const layer of layers) {
      this.ensureChannel(context, master, layer.id);
      this.applyLayerEffects(context, layer.id, layer.effects);
    }
  }

  private ensureChannel(
    context: AudioContext,
    master: GainNode,
    layerId: string
  ): LayerChannel {
    const existing = this.layerChannels.get(layerId);
    if (existing) {
      return existing;
    }

    const input = buildInputEqPath(context);
    const dryGain = context.createGain();
    const delaySend = context.createGain();
    const reverbSend = context.createGain();
    const postEq = input.eqFilters[input.eqFilters.length - 1];

    postEq.connect(dryGain);
    postEq.connect(delaySend);
    postEq.connect(reverbSend);
    dryGain.connect(master);

    const channel: LayerChannel = {
      layerId,
      input,
      dryGain,
      delaySend,
      reverbSend,
      delayBusKey: null,
      reverbBusKey: null,
    };

    this.layerChannels.set(layerId, channel);
    return channel;
  }

  private acquireDelayBus(
    context: AudioContext,
    master: GainNode,
    key: string,
    effects: LayerEffects
  ): DelayBus {
    const existing = this.delayBuses.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing;
    }

    const input = context.createGain();
    const delayNode = context.createDelay(2);
    const delayFeedback = context.createGain();
    const wet = context.createGain();

    input.connect(delayNode);
    delayNode.connect(wet);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    wet.connect(master);

    const bus: DelayBus = {
      key,
      input,
      delayNode,
      delayFeedback,
      wet,
      refCount: 1,
    };

    this.delayBuses.set(key, bus);
    applyDelayBusParams(bus, effects, context);
    return bus;
  }

  private releaseDelayBus(key: string): void {
    const bus = this.delayBuses.get(key);
    if (!bus) {
      return;
    }

    bus.refCount -= 1;
    if (bus.refCount > 0) {
      return;
    }

    try {
      bus.input.disconnect();
      bus.delayNode.disconnect();
      bus.delayFeedback.disconnect();
      bus.wet.disconnect();
    } catch {
      // Already torn down.
    }

    this.delayBuses.delete(key);
  }

  private acquireReverbBus(
    context: AudioContext,
    master: GainNode,
    key: string,
    effects: LayerEffects
  ): ReverbBus {
    const existing = this.reverbBuses.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing;
    }

    const input = context.createGain();
    const convolver = context.createConvolver();
    const wet = context.createGain();

    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(master);

    const bus: ReverbBus = {
      key,
      input,
      convolver,
      wet,
      refCount: 1,
    };

    this.reverbBuses.set(key, bus);
    const reverbNodes: LayerReverbNodes = { reverbConvolver: convolver, reverbWet: wet };
    syncReverbConvolver(reverbNodes, effects, context);
    wet.gain.setValueAtTime(1, context.currentTime);
    return bus;
  }

  private releaseReverbBus(key: string): void {
    const bus = this.reverbBuses.get(key);
    if (!bus) {
      return;
    }

    bus.refCount -= 1;
    if (bus.refCount > 0) {
      return;
    }

    try {
      bus.input.disconnect();
      bus.convolver.disconnect();
      bus.wet.disconnect();
    } catch {
      // Already torn down.
    }

    this.reverbBuses.delete(key);
  }

  private connectDelaySend(channel: LayerChannel, bus: DelayBus): void {
    disconnectSend(channel.delaySend);
    channel.delaySend.connect(bus.input);
  }

  private connectReverbSend(channel: LayerChannel, bus: ReverbBus): void {
    disconnectSend(channel.reverbSend);
    channel.reverbSend.connect(bus.input);
  }

  applyLayerEffects(context: AudioContext, layerId: string, effects: LayerEffects): void {
    const channel = this.layerChannels.get(layerId);
    if (!channel) {
      return;
    }

    const master = this.getMasterGain(context);
    const now = context.currentTime;
    const delayMix = isDelayPathActive(effects) ? effects.delay.mix / 100 : 0;
    const reverbMix = isReverbPathActive(effects) ? getEffectiveReverbMix(effects) : 0;

    applyPathInputEffects(channel.input, effects, context);
    channel.dryGain.gain.setValueAtTime(Math.max(0, 1 - delayMix - reverbMix), now);

    const nextDelayKey = isDelayPathActive(effects) ? delayBusKey(effects) : null;
    if (nextDelayKey !== channel.delayBusKey) {
      if (channel.delayBusKey) {
        disconnectSend(channel.delaySend);
        this.releaseDelayBus(channel.delayBusKey);
        channel.delayBusKey = null;
      }
      if (nextDelayKey) {
        const bus = this.acquireDelayBus(context, master, nextDelayKey, effects);
        this.connectDelaySend(channel, bus);
        channel.delayBusKey = nextDelayKey;
      }
    } else if (nextDelayKey) {
      const bus = this.delayBuses.get(nextDelayKey);
      if (bus) {
        applyDelayBusParams(bus, effects, context);
      }
    }

    channel.delaySend.gain.setValueAtTime(delayMix, now);

    const nextReverbKey = isReverbPathActive(effects) ? reverbBusKey(effects) : null;
    if (nextReverbKey !== channel.reverbBusKey) {
      if (channel.reverbBusKey) {
        disconnectSend(channel.reverbSend);
        this.releaseReverbBus(channel.reverbBusKey);
        channel.reverbBusKey = null;
      }
      if (nextReverbKey) {
        const bus = this.acquireReverbBus(context, master, nextReverbKey, effects);
        this.connectReverbSend(channel, bus);
        channel.reverbBusKey = nextReverbKey;
      }
    } else if (nextReverbKey) {
      const bus = this.reverbBuses.get(nextReverbKey);
      if (bus) {
        const reverbNodes: LayerReverbNodes = {
          reverbConvolver: bus.convolver,
          reverbWet: bus.wet,
        };
        syncReverbConvolver(reverbNodes, effects, context);
      }
    }

    channel.reverbSend.gain.setValueAtTime(reverbMix, now);
  }

  connectChannelInput(channel: LayerChannel, source: AudioNode): void {
    source.connect(channel.input.gain);
  }

  dispose(): void {
    for (const layerId of [...this.layerChannels.keys()]) {
      this.removeLayer(layerId);
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // Already disconnected.
      }
      this.masterGain = null;
    }
  }
}
