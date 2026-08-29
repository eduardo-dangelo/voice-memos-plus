import { Alert } from 'react-native';

import { didCrossAccordionAutoEnableThreshold } from '@/src/audio/trackCollapse';
import {
  markAccordionAutoEnablePromptSeen,
  updateTrackAccordionEnabled,
} from '@/src/storage/memoStore';
import { getPlayableLayers, type Memo } from '@/src/storage/types';

const ACCORDION_AUTO_ENABLE_MESSAGE =
  'Collapse unselected layers was turned on for this memo to improve performance. You can turn it off anytime in the memo menu (…).';

export type AccordionAutoEnableResult = {
  shown: boolean;
  accordionEnabled: boolean;
  memoUpdated: Memo | null;
};

export type AccordionAutoEnableAfterSaveInput = {
  previousMemo: Memo | null;
  savedMemo: Memo;
};

export async function maybeAutoEnableAccordionAfterRecordingSave({
  previousMemo,
  savedMemo,
}: AccordionAutoEnableAfterSaveInput): Promise<AccordionAutoEnableResult> {
  if (savedMemo.accordionAutoEnablePromptSeen) {
    return { shown: false, accordionEnabled: false, memoUpdated: null };
  }

  const previousCount = previousMemo ? getPlayableLayers(previousMemo).length : 0;
  const nextCount = getPlayableLayers(savedMemo).length;

  if (!didCrossAccordionAutoEnableThreshold(previousCount, nextCount)) {
    return { shown: false, accordionEnabled: false, memoUpdated: null };
  }

  let memoUpdated = await markAccordionAutoEnablePromptSeen(savedMemo.id);

  if (memoUpdated.trackAccordionEnabled === true) {
    return { shown: false, accordionEnabled: false, memoUpdated };
  }

  memoUpdated = await updateTrackAccordionEnabled(savedMemo.id, true);

  Alert.alert('Collapse Unselected Tracks', ACCORDION_AUTO_ENABLE_MESSAGE, [{ text: 'OK' }]);

  return { shown: true, accordionEnabled: true, memoUpdated };
}
