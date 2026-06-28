import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listMemos, type MemoListScope } from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';

export function useMemos(scope: MemoListScope = { kind: 'all' }) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const scopeKey = scope.kind === 'folder' ? `folder:${scope.folderId}` : scope.kind;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listMemos(scope);
      setMemos(next);
    } finally {
      setLoading(false);
    }
  }, [scopeKey]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { memos, loading, refresh };
}
