import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { NamePromptDialog } from '@/src/components/NamePromptDialog';
import { RecordingsSplitView } from '@/src/components/RecordingsSplitView';
import { getFolder, renameFolder } from '@/src/storage/folderStore';

export default function FolderRecordingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [folderName, setFolderName] = useState('Folder');
  const [renameVisible, setRenameVisible] = useState(false);

  const loadFolder = useCallback(async () => {
    if (!id) {
      return;
    }
    const folder = await getFolder(id);
    if (folder) {
      setFolderName(folder.name);
    }
  }, [id]);

  useLayoutEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: folderName,
    });
  }, [folderName, navigation]);

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
            });
          }
        }}
      />
    </>
  );
}
