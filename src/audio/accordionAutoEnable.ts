import {
  didCrossAccordionAutoEnableThreshold,
  shouldPromptAccordionAutoEnableBeforeStackAtCount,
} from '@/src/audio/trackCollapse';
import {
  markAccordionAutoEnablePromptSeen,
  updateTrackAccordionEnabled,
} from '@/src/storage/memoStore';
import { getPlayableLayers, type Memo } from '@/src/storage/types';

export const ACCORDION_AUTO_ENABLE_PRE_RECORD_MESSAGE =
  'Unselected tracks will be collapsed to improve app Performance. You can change this at anytime.';

export type AccordionAutoEnableResult = {
  shown: boolean;
  accordionEnabled: boolean;
  memoUpdated: Memo | null;
};

export type AccordionAutoEnableAfterSaveInput = {
  previousMemo: Memo | null;
  savedMemo: Memo;
};

export function shouldPromptAccordionAutoEnableBeforeStack(memo: Memo): boolean {
  return shouldPromptAccordionAutoEnableBeforeStackAtCount(
    getPlayableLayers(memo).length,
    memo.accordionAutoEnablePromptSeen === true,
    memo.trackAccordionEnabled
  );
}

export async function applyAccordionAutoEnableForMemo(memoId: string): Promise<Memo> {
  await markAccordionAutoEnablePromptSeen(memoId);
  return updateTrackAccordionEnabled(memoId, true);
}

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

  return { shown: false, accordionEnabled: true, memoUpdated };
}
