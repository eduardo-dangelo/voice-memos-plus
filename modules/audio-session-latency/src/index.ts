import { requireNativeModule } from 'expo-modules-core';

export type AvAudioSessionIoLatency = {
  inputLatency: number;
  outputLatency: number;
  ioBufferDuration: number;
};

type AudioSessionLatencyModule = {
  isAvailable(): boolean;
  getIoLatency(): AvAudioSessionIoLatency;
};

let nativeModule: AudioSessionLatencyModule | null = null;

function getModule(): AudioSessionLatencyModule | null {
  if (nativeModule) {
    return nativeModule;
  }

  try {
    nativeModule = requireNativeModule<AudioSessionLatencyModule>(
      'AudioSessionLatency'
    );
    return nativeModule;
  } catch {
    return null;
  }
}

/** Current AVAudioSession I/O latencies in seconds, or null if unlinked. */
export function getAvAudioSessionIoLatency(): AvAudioSessionIoLatency | null {
  const module = getModule();
  if (!module?.isAvailable()) {
    return null;
  }

  try {
    const latency = module.getIoLatency();
    if (
      !latency ||
      !Number.isFinite(latency.inputLatency) ||
      !Number.isFinite(latency.outputLatency)
    ) {
      return null;
    }
    return latency;
  } catch {
    return null;
  }
}
