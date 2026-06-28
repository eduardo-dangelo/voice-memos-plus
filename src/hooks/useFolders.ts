import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listFolders } from '@/src/storage/folderStore';
import type { Folder } from '@/src/storage/types';

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listFolders();
      setFolders(next);
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { folders, loading, refresh };
}
