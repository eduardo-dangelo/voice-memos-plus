import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';

import { RecordingsList } from '@/src/components/RecordingsList';
import { getFolder, renameFolder } from '@/src/storage/folderStore';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export default function FolderRecordingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const colors = useVoiceMemosColors();
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
      headerRight: () => (
        <Pressable
          hitSlop={8}
          onPress={() => {
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
          }}
          style={{ paddingHorizontal: 4 }}>
          <SymbolView name={{ ios: 'ellipsis.circle' }} size={22} tintColor={colors.accent} />
        </Pressable>
      ),
    });
  }, [colors.accent, folderName, id, navigation]);

  const folderId = useMemo(() => id ?? '', [id]);

  if (!id) {
    return null;
  }

  return (
    <RecordingsList
      backTitle={folderName}
      emptySubtitle="Tap the red button to record into this folder."
      folderId={folderId}
      scope={{ kind: 'folder', folderId }}
    />
  );
}
