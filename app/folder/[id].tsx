import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { RecordingsSplitView } from '@/src/components/RecordingsSplitView';
import { getFolder, renameFolder } from '@/src/storage/folderStore';

export default function FolderRecordingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [folderName, setFolderName] = useState('Folder');

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
    Alert.prompt(
      'Rename Folder',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            if (value?.trim() && id) {
              void renameFolder(id, value.trim()).then((folder) => {
                setFolderName(folder.name);
              });
            }
          },
        },
      ],
      'plain-text',
      folderName
    );
  }, [folderName, id]);

  const folderId = useMemo(() => id ?? '', [id]);

  if (!id) {
    return null;
  }

  return (
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
  );
}
