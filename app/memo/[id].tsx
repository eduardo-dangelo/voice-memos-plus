import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { MemoEditor } from '@/src/components/MemoEditor';

export default function MemoEditorScreen() {
  const { id, record, backTitle } = useLocalSearchParams<{
    id: string;
    record?: string;
    backTitle?: string;
  }>();

  const handleDismiss = useCallback(() => {
    router.back();
  }, []);

  const handleAutoRecordConsumed = useCallback(() => {
    router.setParams({ record: undefined });
  }, []);

  if (!id || Array.isArray(id)) {
    return null;
  }

  return (
    <MemoEditor
      autoRecord={record === '1'}
      backTitle={typeof backTitle === 'string' ? backTitle : undefined}
      memoId={id}
      presentation="sheet"
      onAutoRecordConsumed={handleAutoRecordConsumed}
      onDismiss={handleDismiss}
    />
  );
}
