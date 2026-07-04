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
  getDelayTimeSec,
  getEffectiveReverbMix,
  isDelayPathActive,
  isReverbPathActive,
  reverbBusKey,
  requiredDelayMaxSec,
  syncReverbConvolver,
  type LayerEffectPathNodes,
  type LayerReverbNodes,
} from '@/src/audio/layerEffectChain';
import type { LayerEffects } from '@/src/audio/layerEffects';

type DelayBus = {
  key: string;
  input: GainNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  wet: GainNode;
  maxDelayTime: number;
  refCount: number;
};

type ReverbBus = {
  key: string;
  input: GainNode;
  convolver: ConvolverNode;
  wet: GainNode;
  refCount: number;
};

export type LayerWetPath = LayerEffectPathNodes & {
  send: GainNode;
};

export type LayerChannel = {
  layerId: string;
  dry: LayerEffectPathNodes & { dryGain: GainNode };
  delay: LayerWetPath | null;
  reverb: LayerWetPath | null;
  delayBusKey: string | null;
  reverbBusKey: string | null;
};

function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

function applyDelayBusParams(bus: DelayBus, effects: LayerEffects, context: AudioContext): void {
  const now = context.currentTime;
  const delayTimeSec = Math.min(bus.maxDelayTime, Math.max(0, getDelayTimeSec(effects)));

  bus.delayNode.delayTime.setValueAtTime(delayTimeSec, now);
  bus.delayFeedback.gain.setValueAtTime(
    Math.min(0.85, Math.max(0, effects.delay.feedback / 100)),
    now
  );
  bus.wet.gain.setValueAtTime(1, now);
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

    this.releaseChannelDelay(channel);
    this.releaseChannelReverb(channel);
    this.teardownWetPath(channel.delay);
    this.teardownWetPath(channel.reverb);

    try {
      channel.dry.gain.disconnect();
      channel.dry.dryGain.disconnect();
    } catch {
      // Nodes may already be torn down.
    }

    this.layerChannels.delete(layerId);
  }

  /** Ensure channels exist and effects are applied for the given layers. */
  syncLayers(context: AudioContext, layers: { id: string; effects: LayerEffects }[]): void {
    this.getMasterGain(context);
    const nextIds = new Set(layers.map((layer) => layer.id));

    for (const layerId of this.layerChannels.keys()) {
      if (!nextIds.has(layerId)) {
        this.removeLayer(layerId);
      }
    }

    for (const layer of layers) {
      this.ensureChannel(context, layer.id);
      this.applyLayerEffects(context, layer.id, layer.effects);
    }
  }

  private ensureChannel(context: AudioContext, layerId: string): LayerChannel {
    const existing = this.layerChannels.get(layerId);
    if (existing) {
      return existing;
    }

    const master = this.getMasterGain(context);
    const input = buildInputEqPath(context);
    const dryGain = context.createGain();
    const postEq = input.eqFilters[input.eqFilters.length - 1];
    postEq.connect(dryGain);
    dryGain.connect(master);
    dryGain.gain.value = 1;

    const channel: LayerChannel = {
      layerId,
      dry: { ...input, dryGain },
      delay: null,
      reverb: null,
      delayBusKey: null,
      reverbBusKey: null,
    };

    this.layerChannels.set(layerId, channel);
    return channel;
  }

  private ensureWetPath(context: AudioContext, existing: LayerWetPath | null): LayerWetPath {
    if (existing) {
      return existing;
    }

    const input = buildInputEqPath(context);
    const send = context.createGain();
    const postEq = input.eqFilters[input.eqFilters.length - 1];
    postEq.connect(send);
    send.gain.value = 0;
    return { ...input, send };
  }

  private teardownWetPath(path: LayerWetPath | null): void {
    if (!path) {
      return;
    }
    try {
      path.gain.disconnect();
      path.send.disconnect();
    } catch {
      // Already torn down.
    }
  }

  private releaseChannelDelay(channel: LayerChannel): void {
    if (channel.delay) {
      disconnectNode(channel.delay.send);
    }
    if (channel.delayBusKey) {
      this.releaseDelayBus(channel.delayBusKey);
      channel.delayBusKey = null;
    }
  }

  private releaseChannelReverb(channel: LayerChannel): void {
    if (channel.reverb) {
      disconnectNode(channel.reverb.send);
    }
    if (channel.reverbBusKey) {
      this.releaseReverbBus(channel.reverbBusKey);
      channel.reverbBusKey = null;
    }
  }

  private acquireDelayBus(
    context: AudioContext,
    key: string,
    effects: LayerEffects
  ): DelayBus {
    const existing = this.delayBuses.get(key);
    if (existing) {
      existing.refCount += 1;
      applyDelayBusParams(existing, effects, context);
      return existing;
    }

    const master = this.getMasterGain(context);
    const maxDelayTime = requiredDelayMaxSec(effects);
    const input = context.createGain();
    const delayNode = context.createDelay(maxDelayTime);
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
      maxDelayTime,
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

  private rekeyDelayBus(bus: DelayBus, nextKey: string): void {
    if (bus.key === nextKey) {
      return;
    }
    this.delayBuses.delete(bus.key);
    bus.key = nextKey;
    this.delayBuses.set(nextKey, bus);
  }

  private recreateDelayBus(
    context: AudioContext,
    previous: DelayBus,
    key: string,
    effects: LayerEffects
  ): DelayBus {
    const subscribers = previous.refCount;
    this.delayBuses.delete(previous.key);
    try {
      previous.input.disconnect();
      previous.delayNode.disconnect();
      previous.delayFeedback.disconnect();
      previous.wet.disconnect();
    } catch {
      // Already torn down.
    }

    const master = this.getMasterGain(context);
    const maxDelayTime = requiredDelayMaxSec(effects);
    const input = context.createGain();
    const delayNode = context.createDelay(maxDelayTime);
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
      maxDelayTime,
      refCount: subscribers,
    };

    this.delayBuses.set(key, bus);
    applyDelayBusParams(bus, effects, context);
    return bus;
  }

  private createReverbBusNodes(
    context: AudioContext,
    key: string,
    effects: LayerEffects
  ): ReverbBus {
    const input = context.createGain();
    const convolver = context.createConvolver();
    const wet = context.createGain();

    const reverbNodes: LayerReverbNodes = { reverbConvolver: convolver, reverbWet: wet };
    syncReverbConvolver(reverbNodes, effects, context);

    const master = this.getMasterGain(context);
    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(master);
    wet.gain.setValueAtTime(1, context.currentTime);

    return { key, input, convolver, wet, refCount: 0 };
  }

  private acquireReverbBus(
    context: AudioContext,
    key: string,
    effects: LayerEffects
  ): ReverbBus {
    const existing = this.reverbBuses.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing;
    }

    const bus = this.createReverbBusNodes(context, key, effects);
    bus.refCount = 1;
    this.reverbBuses.set(key, bus);
    return bus;
  }

  private recreateReverbBus(
    context: AudioContext,
    previous: ReverbBus,
    key: string,
    effects: LayerEffects,
    channel: LayerChannel
  ): ReverbBus {
    const subscribers = previous.refCount;
    this.reverbBuses.delete(previous.key);
    try {
      previous.input.disconnect();
      previous.convolver.disconnect();
      previous.wet.disconnect();
    } catch {
      // Already torn down.
    }

    const bus = this.createReverbBusNodes(context, key, effects);
    bus.refCount = subscribers;
    this.reverbBuses.set(key, bus);
    this.connectReverbSend(channel, bus);
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
    if (!channel.delay) {
      return;
    }
    disconnectNode(channel.delay.send);
    channel.delay.send.connect(bus.input);
  }

  private connectReverbSend(channel: LayerChannel, bus: ReverbBus): void {
    if (!channel.reverb) {
      return;
    }
    disconnectNode(channel.reverb.send);
    channel.reverb.send.connect(bus.input);
  }

  /**
   * Attach or update delay bus for a channel.
   * Updates in place when this layer is the sole subscriber (avoids scrub thrash).
   * Moves to a new bus when diverging from a shared bus or when max delay must grow.
   */
  private syncDelayBus(
    context: AudioContext,
    channel: LayerChannel,
    effects: LayerEffects
  ): void {
    const nextKey = delayBusKey(effects);
    const neededMax = requiredDelayMaxSec(effects);

    if (!channel.delayBusKey) {
      const bus = this.acquireDelayBus(context, nextKey, effects);
      this.connectDelaySend(channel, bus);
      channel.delayBusKey = nextKey;
      return;
    }

    const current = this.delayBuses.get(channel.delayBusKey);
    if (!current) {
      channel.delayBusKey = null;
      const bus = this.acquireDelayBus(context, nextKey, effects);
      this.connectDelaySend(channel, bus);
      channel.delayBusKey = nextKey;
      return;
    }

    if (channel.delayBusKey === nextKey) {
      applyDelayBusParams(current, effects, context);
      return;
    }

    // Sole subscriber: update in place (and grow buffer if needed).
    if (current.refCount === 1) {
      if (neededMax > current.maxDelayTime) {
        const bus = this.recreateDelayBus(context, current, nextKey, effects);
        this.connectDelaySend(channel, bus);
        channel.delayBusKey = nextKey;
        return;
      }
      applyDelayBusParams(current, effects, context);
      this.rekeyDelayBus(current, nextKey);
      channel.delayBusKey = nextKey;
      return;
    }

    // Shared bus: diverge this layer onto its own settings.
    disconnectNode(channel.delay!.send);
    this.releaseDelayBus(channel.delayBusKey);
    channel.delayBusKey = null;
    const bus = this.acquireDelayBus(context, nextKey, effects);
    this.connectDelaySend(channel, bus);
    channel.delayBusKey = nextKey;
  }

  private syncReverbBus(
    context: AudioContext,
    channel: LayerChannel,
    effects: LayerEffects
  ): void {
    const nextKey = reverbBusKey(effects);

    if (!channel.reverbBusKey) {
      const bus = this.acquireReverbBus(context, nextKey, effects);
      this.connectReverbSend(channel, bus);
      channel.reverbBusKey = nextKey;
      return;
    }

    if (channel.reverbBusKey === nextKey) {
      return;
    }

    const current = this.reverbBuses.get(channel.reverbBusKey);
    if (current && current.refCount === 1) {
      this.recreateReverbBus(context, current, nextKey, effects, channel);
      channel.reverbBusKey = nextKey;
      return;
    }

    disconnectNode(channel.reverb!.send);
    this.releaseReverbBus(channel.reverbBusKey);
    channel.reverbBusKey = null;
    const bus = this.acquireReverbBus(context, nextKey, effects);
    this.connectReverbSend(channel, bus);
    channel.reverbBusKey = nextKey;
  }

  applyLayerEffects(context: AudioContext, layerId: string, effects: LayerEffects): void {
    const channel = this.ensureChannel(context, layerId);
    const now = context.currentTime;
    const delayActive = isDelayPathActive(effects);
    const reverbActive = isReverbPathActive(effects);
    const delayMix = delayActive ? effects.delay.mix / 100 : 0;
    const reverbMix = reverbActive ? getEffectiveReverbMix(effects) : 0;

    applyPathInputEffects(channel.dry, effects, context);
    // Send-style: dry stays full; wet is additive.
    channel.dry.dryGain.gain.setValueAtTime(1, now);

    if (delayActive) {
      channel.delay = this.ensureWetPath(context, channel.delay);
      applyPathInputEffects(channel.delay, effects, context);
      this.syncDelayBus(context, channel, effects);
      channel.delay.send.gain.setValueAtTime(delayMix, now);
    } else {
      this.releaseChannelDelay(channel);
      if (channel.delay) {
        channel.delay.send.gain.setValueAtTime(0, now);
      }
    }

    if (reverbActive) {
      channel.reverb = this.ensureWetPath(context, channel.reverb);
      applyPathInputEffects(channel.reverb, effects, context);
      this.syncReverbBus(context, channel, effects);
      channel.reverb.send.gain.setValueAtTime(reverbMix, now);
    } else {
      this.releaseChannelReverb(channel);
      if (channel.reverb) {
        channel.reverb.send.gain.setValueAtTime(0, now);
      }
    }
  }

  connectSourceToPath(source: AudioNode, path: LayerEffectPathNodes): void {
    source.connect(path.gain);
  }

  dispose(): void {
    for (const layerId of [...this.layerChannels.keys()]) {
      this.removeLayer(layerId);
    }

    this.delayBuses.clear();
    this.reverbBuses.clear();

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
