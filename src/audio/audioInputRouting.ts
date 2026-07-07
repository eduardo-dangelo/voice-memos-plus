import { AudioManager } from 'react-native-audio-api';

const BLUETOOTH_INPUT_CATEGORIES = new Set([
  'BluetoothHFP',
  'HeadsetMic',
  'BluetoothLE',
]);

const MIN_STABLE_SAMPLE_RATE = 32000;

export type RouteSnapshot = {
  inputCategory: string | null;
  outputCategory: string | null;
  sessionSampleRate: number;
  isHfpActive: boolean;
};

function firstCategory(
  devices: { category: string }[] | undefined
): string | null {
  return devices?.[0]?.category ?? null;
}

export async function findBuiltInMicrophone(): Promise<{
  id: string;
  category: string;
} | null> {
  const devices = await AudioManager.getDevicesInfo();
  const inputs = devices.availableInputs ?? [];

  const builtIn = inputs.find((device) => device.category === 'BuiltInMic');
  if (builtIn) {
    return { id: builtIn.id, category: builtIn.category };
  }

  const fallback = inputs.find(
    (device) => !BLUETOOTH_INPUT_CATEGORIES.has(device.category)
  );
  if (fallback) {
    return { id: fallback.id, category: fallback.category };
  }

  return null;
}

export async function pinBuiltInMicrophone(): Promise<void> {
  const builtIn = await findBuiltInMicrophone();
  if (!builtIn) {
    throw new Error('Built-in microphone is not available');
  }
  await AudioManager.setInputDevice(builtIn.id);
}

export async function getActiveRouteSnapshot(): Promise<RouteSnapshot> {
  const devices = await AudioManager.getDevicesInfo();
  const inputCategory = firstCategory(devices.currentInputs);
  const outputCategory = firstCategory(devices.currentOutputs);
  const sessionSampleRate = Math.round(AudioManager.getDevicePreferredSampleRate());

  const isHfpActive =
    inputCategory === 'BluetoothHFP' ||
    outputCategory === 'BluetoothHFP' ||
    (devices.currentInputs ?? []).some((d) => d.category === 'BluetoothHFP') ||
    (devices.currentOutputs ?? []).some((d) => d.category === 'BluetoothHFP');

  return {
    inputCategory,
    outputCategory,
    sessionSampleRate,
    isHfpActive,
  };
}

export async function assertRecordingRouteOk(): Promise<RouteSnapshot> {
  const snapshot = await getActiveRouteSnapshot();

  if (snapshot.isHfpActive) {
    throw new Error(
      "Couldn't start recording with a stable audio route. Try disconnecting and reconnecting your headphones."
    );
  }

  if (
    snapshot.inputCategory !== null &&
    BLUETOOTH_INPUT_CATEGORIES.has(snapshot.inputCategory)
  ) {
    throw new Error(
      "Couldn't use the iPhone microphone. Try disconnecting and reconnecting your headphones."
    );
  }

  if (snapshot.sessionSampleRate < MIN_STABLE_SAMPLE_RATE) {
    throw new Error(
      "Couldn't start recording with a stable audio route. Try disconnecting and reconnecting your headphones."
    );
  }

  return snapshot;
}

export function logRouteSnapshot(label: string, snapshot: RouteSnapshot): void {
  if (!__DEV__) {
    return;
  }
  console.log(
    `[audio route] ${label}`,
    JSON.stringify(snapshot)
  );
}
