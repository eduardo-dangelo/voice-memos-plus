import * as Location from 'expo-location';

import { deduplicateTitle, formatLocationTitle } from '@/src/location/formatLocationTitle';
import { notifyMemoUpdate } from '@/src/recording/memoUpdateEvents';
import { getAppSettings } from '@/src/settings/appSettings';
import {
  getMemo,
  listAllActiveMemos,
  updateLocationTitle,
} from '@/src/storage/memoStore';

export async function applyLocationTitleIfEnabled(memoId: string): Promise<void> {
  const settings = await getAppSettings();
  if (!settings.locationBasedNaming) {
    return;
  }

  const memo = await getMemo(memoId);
  if (!memo || memo.titleSource === 'user') {
    return;
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) {
    return;
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const addresses = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    const locationTitle = formatLocationTitle(addresses[0]);
    if (!locationTitle) {
      return;
    }

    const freshMemo = await getMemo(memoId);
    if (!freshMemo || freshMemo.titleSource === 'user') {
      return;
    }

    const existingTitles = (await listAllActiveMemos())
      .filter((entry) => entry.id !== memoId)
      .map((entry) => entry.title);
    const title = deduplicateTitle(locationTitle, existingTitles);
    const updated = await updateLocationTitle(memoId, title);
    notifyMemoUpdate(updated);
  } catch (error) {
    if (__DEV__) {
      console.warn('[locationNaming] applyLocationTitleIfEnabled failed', error);
    }
  }
}
