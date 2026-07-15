import { Stack, router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import {
  GroupedListRow,
  GroupedListScreen,
  GroupedListSection,
  GroupedListSectionHeader,
} from '@/src/components/GroupedList';
import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { useFolders } from '@/src/hooks/useFolders';
import { useLibraryCounts } from '@/src/hooks/useLibraryCounts';
import {
  getAppSettings,
  setLocationBasedNaming,
  setThemePreference,
  type ThemePreference,
} from '@/src/settings/appSettings';
import { createFolder, deleteFolder, reorderFolders } from '@/src/storage/folderStore';
import { applyThemePreference } from '@/src/theme/applyThemePreference';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export default function FoldersHomeScreen() {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const headerStyles = useHeaderStyles(colors, colorScheme);
  const { folders, refresh: refreshFolders } = useFolders();
  const { counts, refresh: refreshCounts } = useLibraryCounts();
  const [editMode, setEditMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [locationBasedNaming, setLocationBasedNamingEnabled] = useState(true);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');

  const refresh = () => {
    refreshFolders();
    refreshCounts();
  };

  useEffect(() => {
    void getAppSettings().then((settings) => {
      setLocationBasedNamingEnabled(settings.locationBasedNaming);
      setThemePreferenceState(settings.themePreference);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setShowSettings(false);
      };
    }, [])
  );

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

  const selectThemePreference = (pref: ThemePreference) => {
    setThemePreferenceState(pref);
    applyThemePreference(pref);
    void setThemePreference(pref);
  };

  const overrideEnabled = themePreference !== 'system';
  const darkModeEnabled = themePreference === 'dark';

  const toggleOverride = (enabled: boolean) => {
    if (!enabled) {
      selectThemePreference('system');
      return;
    }
    selectThemePreference(colorScheme === 'dark' ? 'dark' : 'light');
  };

  const toggleDarkMode = (enabled: boolean) => {
    selectThemePreference(enabled ? 'dark' : 'light');
  };

  const handleNewFolder = useCallback(() => {
    Alert.prompt(
      'New Folder',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            void createFolder(value?.trim() || 'New Folder').then(() => {
              refreshFolders();
              refreshCounts();
            });
          },
        },
      ],
      'plain-text',
      'New Folder'
    );
  }, [refreshCounts, refreshFolders]);

  const toggleSettings = useCallback(() => {
    setShowSettings((current) => !current);
  }, []);

  const toggleEditMode = useCallback(() => {
    setEditMode((current) => !current);
  }, []);

  const headerScreenOptions = useMemo(
    () => ({
      title: '',
      headerLargeTitle: false,
      headerShadowVisible: false,
      headerTintColor: colors.text,
      headerStyle: { backgroundColor: headerStyles.canvasColor },
      headerLargeStyle: { backgroundColor: headerStyles.canvasColor },
      contentStyle: { backgroundColor: headerStyles.canvasColor },
      ...(Platform.OS === 'ios'
        ? {
            unstable_headerRightItems: () => {
              const items = [
                {
                  type: 'custom' as const,
                  hidesSharedBackground: true,
                  sharesBackground: false,
                  element: (
                    <FloatingHeaderButton
                      accessibilityLabel={showSettings ? 'Hide settings' : 'Show settings'}
                      icon={showSettings ? 'gearshape.fill' : 'gearshape'}
                      onPress={toggleSettings}
                    />
                  ),
                },
                {
                  type: 'custom' as const,
                  hidesSharedBackground: true,
                  sharesBackground: false,
                  element: (
                    <FloatingHeaderButton
                      accessibilityLabel="New folder"
                      icon="folder.badge.plus"
                      onPress={handleNewFolder}
                    />
                  ),
                },
              ];
              if (hasFolders) {
                items.push({
                  type: 'custom' as const,
                  hidesSharedBackground: true,
                  sharesBackground: false,
                  element: (
                    <FloatingHeaderButton
                      accessibilityLabel={editMode ? 'Done editing folders' : 'Edit folders'}
                      label={editMode ? 'Done' : 'Edit'}
                      variant="pill"
                      onPress={toggleEditMode}
                    />
                  ),
                });
              }
              return items;
            },
          }
        : {
            headerRight: () => (
              <View style={styles.headerActions}>
                <FloatingHeaderButton
                  accessibilityLabel={showSettings ? 'Hide settings' : 'Show settings'}
                  icon={showSettings ? 'gearshape.fill' : 'gearshape'}
                  onPress={toggleSettings}
                />
                <FloatingHeaderButton
                  accessibilityLabel="New folder"
                  icon="folder.badge.plus"
                  onPress={handleNewFolder}
                />
                {hasFolders ? (
                  <FloatingHeaderButton
                    accessibilityLabel={editMode ? 'Done editing folders' : 'Edit folders'}
                    label={editMode ? 'Done' : 'Edit'}
                    variant="pill"
                    onPress={toggleEditMode}
                  />
                ) : null}
              </View>
            ),
          }),
    }),
    [
      colors.text,
      editMode,
      handleNewFolder,
      hasFolders,
      headerStyles.canvasColor,
      showSettings,
      styles.headerActions,
      toggleEditMode,
      toggleSettings,
    ]
  );

  return (
    <>
      <Stack.Screen options={headerScreenOptions} />
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

        {showSettings ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(160)}
            layout={LinearTransition.duration(220)}>
            <GroupedListSectionHeader title="Settings" />
            <GroupedListSection>
              <View
                style={[styles.settingsRow, !overrideEnabled && styles.settingsRowBorder]}>
                <View style={styles.settingsCopy}>
                  <Text style={styles.settingsTitle}>Appearance</Text>
                  <Text style={styles.settingsSubtitle}>
                    Off follows your system setting. Turn on to choose light or dark.
                  </Text>
                </View>
                <Switch value={overrideEnabled} onValueChange={toggleOverride} />
              </View>
              {overrideEnabled ? (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(140)}
                  style={[styles.settingsRow, styles.settingsRowNested, styles.settingsRowBorder]}>
                  <SymbolView
                    name={{ ios: !darkModeEnabled ? 'moon.fill' : 'sun.max.fill' }}
                    size={20}
                    tintColor={colors.accent}
                  />
                  <View style={styles.settingsCopy}>
                    <Text style={styles.settingsTitle}>
                      {darkModeEnabled ? 'Light Mode' : 'Dark Mode'}
                    </Text>
                  </View>
                  <Switch value={darkModeEnabled} onValueChange={toggleDarkMode} />
                </Animated.View>
              ) : null}
              <View style={styles.settingsRow}>
                <View style={styles.settingsCopy}>
                  <Text style={styles.settingsTitle}>Location-based Naming</Text>
                  <Text style={styles.settingsSubtitle}>
                    Name new recordings using your current location.
                  </Text>
                </View>
                <Switch
                  value={locationBasedNaming}
                  onValueChange={(enabled) => {
                    setLocationBasedNamingEnabled(enabled);
                    void setLocationBasedNaming(enabled);
                  }}
                />
              </View>
            </GroupedListSection>
          </Animated.View>
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
  const nestedSurface =
    colorScheme === 'dark' ? colors.pillBackground : colors.editorCanvasBackground;

  return useMemo(
    () =>
      StyleSheet.create({
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        editControls: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        disabledControl: {
          opacity: 0.3,
        },
        settingsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          paddingHorizontal: 16,
          paddingVertical: 12,
          minHeight: 58,
        },
        settingsRowBorder: {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.separator,
        },
        settingsRowNested: {
          minHeight: 48,
          backgroundColor: nestedSurface,
        },
        settingsCopy: {
          flex: 1,
          gap: 2,
        },
        settingsTitle: {
          color: colors.text,
          fontSize: 17,
        },
        settingsSubtitle: {
          color: colors.secondaryText,
          fontSize: 13,
        },
      }),
    [nestedSurface, colors.secondaryText, colors.separator, colors.text]
  );
}
