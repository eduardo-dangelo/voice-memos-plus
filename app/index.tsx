import { SymbolView } from 'expo-symbols';
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import {
  GroupedListRow,
  GroupedListScreen,
  GroupedListSection,
  GroupedListSectionHeader,
} from '@/src/components/GroupedList';
import { useFolders } from '@/src/hooks/useFolders';
import { useLibraryCounts } from '@/src/hooks/useLibraryCounts';
import { createFolder, deleteFolder, reorderFolders } from '@/src/storage/folderStore';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export default function FoldersHomeScreen() {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const headerStyles = useHeaderStyles(colors, colorScheme);
  const { folders, refresh: refreshFolders } = useFolders();
  const { counts, refresh: refreshCounts } = useLibraryCounts();
  const [editMode, setEditMode] = useState(false);

  const refresh = () => {
    refreshFolders();
    refreshCounts();
  };

  const folderRows = useMemo(() => folders, [folders]);
  const hasFolders = folderRows.length > 0;

  useEffect(() => {
    if (!hasFolders && editMode) {
      setEditMode(false);
    }
  }, [editMode, hasFolders]);

  const moveFolder = (folderId: string, direction: -1 | 1) => {
    const index = folderRows.findIndex((folder) => folder.id === folderId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folderRows.length) {
      return;
    }
    const orderedIds = folderRows.map((folder) => folder.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    void reorderFolders(orderedIds).then(refresh);
  };

  const confirmDeleteFolder = (folderId: string, name: string) => {
    Alert.alert('Delete Folder', `Delete "${name}"? Recordings will remain in All Recordings.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteFolder(folderId).then(refresh);
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerStyle: { backgroundColor: headerStyles.canvasColor },
          headerLargeStyle: { backgroundColor: headerStyles.canvasColor },
          contentStyle: { backgroundColor: headerStyles.canvasColor },
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  Alert.prompt(
                    'New Folder',
                    undefined,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Save',
                        onPress: (value?: string) => {
                          void createFolder(value?.trim() || 'New Folder').then(refresh);
                        },
                      },
                    ],
                    'plain-text',
                    'New Folder'
                  );
                }}
                style={styles.newFolderButton}>
                <SymbolView
                  name={{ ios: 'folder.badge.plus' }}
                  size={28}
                  tintColor={colors.accent}
                />
              </Pressable>
              {hasFolders ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => setEditMode((current) => !current)}
                  style={styles.editButton}>
                  <Text style={styles.editText}>{editMode ? 'Done' : 'Edit'}</Text>
                </Pressable>
              ) : null}
            </View>
          ),
        }}
      />
      <GroupedListScreen largeTitle="Voice Memos">
        <GroupedListSection>
          <GroupedListRow
            count={counts.allCount}
            icon="waveform"
            isFirst
            title="All Recordings"
            onPress={() => router.push('/recordings')}
          />
          <GroupedListRow
            count={counts.trashCount}
            icon="trash"
            isLast
            title="Recently Deleted"
            onPress={() => router.push('/recently-deleted')}
          />
        </GroupedListSection>

        {hasFolders ? (
          <>
            <GroupedListSectionHeader title="My Folders" />
            <GroupedListSection>
              {folderRows.map((folder, index) => (
                <GroupedListRow
                  key={folder.id}
                  accessory={
                    editMode ? (
                      <View style={styles.editControls}>
                        <Pressable
                          disabled={index === 0}
                          hitSlop={8}
                          onPress={() => moveFolder(folder.id, -1)}
                          style={index === 0 ? styles.disabledControl : undefined}>
                          <SymbolView
                            name={{ ios: 'chevron.up' }}
                            size={14}
                            tintColor={colors.secondaryText}
                          />
                        </Pressable>
                        <Pressable
                          disabled={index === folderRows.length - 1}
                          hitSlop={8}
                          onPress={() => moveFolder(folder.id, 1)}
                          style={
                            index === folderRows.length - 1 ? styles.disabledControl : undefined
                          }>
                          <SymbolView
                            name={{ ios: 'chevron.down' }}
                            size={14}
                            tintColor={colors.secondaryText}
                          />
                        </Pressable>
                        <Pressable
                          hitSlop={8}
                          onPress={() => confirmDeleteFolder(folder.id, folder.name)}>
                          <SymbolView
                            name={{ ios: 'minus.circle.fill' }}
                            size={22}
                            tintColor={colors.recordRed}
                          />
                        </Pressable>
                      </View>
                    ) : undefined
                  }
                  count={counts.folderCounts[folder.id] ?? 0}
                  icon="folder"
                  isFirst={index === 0}
                  isLast={index === folderRows.length - 1}
                  showChevron={!editMode}
                  showCount={!editMode}
                  title={folder.name}
                  onPress={editMode ? undefined : () => router.push(`/folder/${folder.id}`)}
                />
              ))}
            </GroupedListSection>
          </>
        ) : null}
      </GroupedListScreen>
    </>
  );
}

function useHeaderStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  return useMemo(
    () => ({
      canvasColor:
        colorScheme === 'dark' ? colors.background : colors.editorCanvasBackground,
    }),
    [colorScheme, colors.background, colors.editorCanvasBackground]
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const buttonSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

  return useMemo(
    () =>
      StyleSheet.create({
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        newFolderButton: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: buttonSurface,
        },
        editButton: {
          backgroundColor: buttonSurface,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 7,
          minHeight: 36,
          justifyContent: 'center',
        },
        editText: {
          color: colors.accent,
          fontSize: 16,
          fontWeight: '400',
        },
        editControls: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        disabledControl: {
          opacity: 0.3,
        },
      }),
    [buttonSurface, colors.accent]
  );
}
