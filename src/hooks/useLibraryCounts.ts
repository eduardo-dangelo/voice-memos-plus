import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listAllActiveMemos, listTrashMemos } from '@/src/storage/memoStore';

export type LibraryCounts = {
  allCount: number;
  trashCount: number;
  folderCounts: Record<string, number>;
};

export function useLibraryCounts() {
  const [counts, setCounts] = useState<LibraryCounts>({
    allCount: 0,
    trashCount: 0,
    folderCounts: {},
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [active, trash] = await Promise.all([listAllActiveMemos(), listTrashMemos()]);
      const folderCounts: Record<string, number> = {};
      for (const memo of active) {
        if (memo.folderId) {
          folderCounts[memo.folderId] = (folderCounts[memo.folderId] ?? 0) + 1;
        }
      }
      setCounts({
        allCount: active.length,
        trashCount: trash.length,
        folderCounts,
      });
    } catch {
      setCounts({ allCount: 0, trashCount: 0, folderCounts: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { counts, loading, refresh };
}
