import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { subscribeMemoUpdate } from '@/src/recording/memoUpdateEvents';
import { listMemos, type MemoListScope } from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';

type RefreshOptions = {
  silent?: boolean;
};

export function useMemos(scope: MemoListScope = { kind: 'all' }) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const scopeKey = scope.kind === 'folder' ? `folder:${scope.folderId}` : scope.kind;

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const next = await listMemos(scope);
        setMemos(next);
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [scopeKey]
  );

  const removeMemo = useCallback((memoId: string) => {
    setMemos((current) => current.filter((memo) => memo.id !== memoId));
  }, []);

  const removeMemos = useCallback((memoIds: string[]) => {
    const ids = new Set(memoIds);
    setMemos((current) => current.filter((memo) => !ids.has(memo.id)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    return subscribeMemoUpdate((memo) => {
      setMemos((current) => {
        const index = current.findIndex((entry) => entry.id === memo.id);
        if (index < 0) {
          return current;
        }
        const next = [...current];
        next[index] = memo;
        return next;
      });
    });
  }, []);

  return { memos, loading, refresh, removeMemo, removeMemos };
}
