import { AudioManager } from 'react-native-audio-api';
import { useEffect, useState } from 'react';

import type { Memo } from '@/src/storage/types';
import { getPlayableLayers } from '@/src/storage/types';

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

export function requiresHeadphones(
  memo: Memo,
  mode: 'replace' | 'stack'
): boolean {
  if (mode === 'stack') {
    return true;
  }
  return getPlayableLayers(memo).length > 1;
}

export function needsMonitorMix(memo: Memo, mode: 'replace' | 'stack'): boolean {
  if (mode === 'stack') {
    return true;
  }
  return mode === 'replace' && getPlayableLayers(memo).length > 1;
}

const DISCONNECT_ROUTE_REASONS = new Set(['OldDeviceUnavailable', 'ConfigurationChange']);

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

export function useHeadphonesConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      const next = await isHeadphonesConnected();
      if (mounted) {
        setConnected(next);
      }
    }

    void refresh();

    const subscription = AudioManager.addSystemEventListener('routeChange', () => {
      void refresh();
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  return connected;
}
