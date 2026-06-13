import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listMemos } from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';

export function useMemos() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listMemos();
      setMemos(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { memos, loading, refresh };
}
