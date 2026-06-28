import { ActionSheetIOS } from 'react-native';

import { listFolders } from '@/src/storage/folderStore';
import { moveMemoToFolder } from '@/src/storage/memoStore';

export async function showMoveToFolderActionSheet(
  memoId: string,
  currentFolderId: string | undefined,
  onMoved: () => void
): Promise<void> {
  const folders = await listFolders();
  const options = [
    ...folders.map((folder) => folder.name),
    ...(currentFolderId ? (['Remove from Folder'] as const) : []),
    'Cancel',
  ] as string[];

  const cancelIndex = options.length - 1;
  const removeIndex = currentFolderId ? options.indexOf('Remove from Folder') : -1;

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Move to Folder',
      options,
      cancelButtonIndex: cancelIndex,
    },
    (index) => {
      if (index === cancelIndex) {
        return;
      }
      if (index === removeIndex) {
        void moveMemoToFolder(memoId, null).then(onMoved);
        return;
      }
      const folder = folders[index];
      if (folder) {
        void moveMemoToFolder(memoId, folder.id).then(onMoved);
      }
    }
  );
}
