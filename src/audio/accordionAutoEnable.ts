import { Alert } from 'react-native';

import { didCrossAccordionAutoEnableThreshold } from '@/src/audio/trackCollapse';
import { markAccordionAutoEnablePromptSeen } from '@/src/storage/memoStore';
import { getPlayableLayers, type Memo } from '@/src/storage/types';
import { setTrackAccordionEnabled } from '@/src/settings/appSettings';

const ACCORDION_AUTO_ENABLE_MESSAGE =
  'Collapse unselected layers were turned on to improve performance. You can turn off at any time in the memo menu (…).';

export type AccordionAutoEnableResult = {
  shown: boolean;
  accordionEnabled: boolean;
  memoUpdated: Memo | null;
};

export type AccordionAutoEnableAfterSaveInput = {
  previousMemo: Memo | null;
  savedMemo: Memo;
  trackAccordionEnabled: boolean;
};

export async function maybeAutoEnableAccordionAfterRecordingSave({
  previousMemo,
  savedMemo,
  trackAccordionEnabled,
}: AccordionAutoEnableAfterSaveInput): Promise<AccordionAutoEnableResult> {
  if (savedMemo.accordionAutoEnablePromptSeen) {
    return { shown: false, accordionEnabled: false, memoUpdated: null };
  }

  const previousCount = previousMemo ? getPlayableLayers(previousMemo).length : 0;
  const nextCount = getPlayableLayers(savedMemo).length;

  if (!didCrossAccordionAutoEnableThreshold(previousCount, nextCount)) {
    return { shown: false, accordionEnabled: false, memoUpdated: null };
  }

  const memoUpdated = await markAccordionAutoEnablePromptSeen(savedMemo.id);

  if (trackAccordionEnabled) {
    return { shown: false, accordionEnabled: false, memoUpdated };
  }

  await setTrackAccordionEnabled(true);

  Alert.alert('Collapse Unselected Tracks', ACCORDION_AUTO_ENABLE_MESSAGE, [{ text: 'OK' }]);

  return { shown: true, accordionEnabled: true, memoUpdated };
}
