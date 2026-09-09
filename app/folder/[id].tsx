import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { NamePromptDialog } from '@/src/components/NamePromptDialog';
import { RecordingsSplitView } from '@/src/components/RecordingsSplitView';
import { getFolderSync, renameFolder } from '@/src/storage/folderStore';

function paramString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

export default function FolderRecordingsScreen() {
  const { id: idParam, name: nameParam } = useLocalSearchParams<{
    id: string;
    name?: string;
  }>();
  const id = paramString(idParam);
  const nameFromRoute = paramString(nameParam)?.trim();
  const navigation = useNavigation();
  const [folderName, setFolderName] = useState(nameFromRoute || 'Folder');
  const [renameVisible, setRenameVisible] = useState(false);

  useLayoutEffect(() => {
    if (!id) {
      return;
    }
    const resolved = getFolderSync(id)?.name ?? nameFromRoute ?? 'Folder';
    setFolderName(resolved);
    navigation.setOptions({ title: resolved });
  }, [id, nameFromRoute, navigation]);

  const showRenamePrompt = useCallback(() => {
    setRenameVisible(true);
  }, []);

  const folderId = useMemo(() => id ?? '', [id]);

  if (!id) {
    return null;
  }

  return (
    <>
      <RecordingsSplitView
        backTitle={folderName}
        emptySubtitle="Tap the red button to record into this folder."
        folderId={folderId}
        headerExtraActions={
          <FloatingHeaderButton
            accessibilityLabel="Folder options"
            icon="ellipsis.circle"
            onPress={showRenamePrompt}
          />
        }
        scope={{ kind: 'folder', folderId }}
        title={folderName}
      />
      <NamePromptDialog
        initialValue={folderName}
        title="Rename Folder"
        visible={renameVisible}
        onCancel={() => setRenameVisible(false)}
        onSave={(value) => {
          setRenameVisible(false);
          if (value.trim() && id) {
            void renameFolder(id, value.trim()).then((folder) => {
              setFolderName(folder.name);
              navigation.setOptions({ title: folder.name });
            });
          }
        }}
      />
    </>
  );
}
