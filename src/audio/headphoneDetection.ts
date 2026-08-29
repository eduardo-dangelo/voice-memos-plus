import { AudioManager } from 'react-native-audio-api';

import { isSealedHeadphoneCategory } from '@/src/audio/recordingLatency';
import type { Memo } from '@/src/storage/types';
import { getPlayableLayers } from '@/src/storage/types';

/**
 * TEMP (alignment QA): allow metronome + stack/replace without headphones.
 * Set back to `false` (or delete) after speaker-stack testing.
 */
export const ALLOW_METRONOME_WITHOUT_HEADPHONES = false;

const SPEAKER_CATEGORIES = new Set(['BuiltInSpeaker', 'BuiltInReceiver']);

const HEADPHONE_CATEGORIES = new Set([
  'Headphones',
  'HeadsetMic',
  'BluetoothA2DP',
  'BluetoothHFP',
  'BluetoothLE',
  'USBAudio',
  'LineOut',
  'HDMI',
  'AirPlay',
  'CarAudio',
]);

function isHeadphoneCategory(category: string): boolean {
  if (HEADPHONE_CATEGORIES.has(category)) {
    return true;
  }
  if (SPEAKER_CATEGORIES.has(category)) {
    return false;
  }
  return category.length > 0 && !category.toLowerCase().includes('speaker');
}

export async function isHeadphonesConnected(): Promise<boolean> {
  try {
    const devices = await AudioManager.getDevicesInfo();
    const outputs = devices.currentOutputs ?? [];
    if (outputs.length === 0) {
      return false;
    }
    return outputs.some((device) => isHeadphoneCategory(device.category));
  } catch {
    return false;
  }
}

export function needsMonitorMix(memo: Memo, mode: 'replace' | 'stack'): boolean {
  if (mode === 'stack') {
    return true;
  }
  return mode === 'replace' && getPlayableLayers(memo).length > 1;
}

/**
 * True when at least one current output is a sealed/private cue path
 * (wired headphones, USB, in-ear BT). Built-in speaker and room remotes
 * are not sealed — see recordingLatency.classifyMonitorPath.
 */
export async function isSealedHeadphonesConnected(): Promise<boolean> {
  try {
    const devices = await AudioManager.getDevicesInfo();
    const outputs = devices.currentOutputs ?? [];
    if (outputs.length === 0) {
      return false;
    }
    return outputs.some((device) => isSealedHeadphoneCategory(device.category));
  } catch {
    return false;
  }
}

// Unlock / Live Activity allow prompts fire ConfigurationChange without a real unplug.
const DISCONNECT_ROUTE_REASONS = new Set(['OldDeviceUnavailable']);

export function subscribeHeadphoneDisconnect(onDisconnect: () => void): () => void {
  const subscription = AudioManager.addSystemEventListener('routeChange', (event) => {
    if (!DISCONNECT_ROUTE_REASONS.has(event.reason)) {
      return;
    }
    void isHeadphonesConnected().then((connected) => {
      if (!connected) {
        onDisconnect();
      }
    });
  });

  return () => {
    subscription?.remove();
  };
}

/** Initial check + live updates whenever the audio route changes. */
export function subscribeHeadphonesConnected(
  onChange: (connected: boolean) => void
): () => void {
  let cancelled = false;

  const refresh = () => {
    void isHeadphonesConnected().then((connected) => {
      if (!cancelled) {
        onChange(connected);
      }
    });
  };

  refresh();
  const subscription = AudioManager.addSystemEventListener('routeChange', () => {
    refresh();
  });

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}
