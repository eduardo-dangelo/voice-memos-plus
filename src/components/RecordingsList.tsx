import { SymbolView } from 'expo-symbols';
import { Stack, router, useFocusEffect } from 'expo-router';
import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import { memoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { LIST_ITEM_TRANSITION } from '@/src/components/listTransitions';
import {
  RecordFabCluster,
  type RecordFabSettings,
} from '@/src/components/RecordFabCluster';
import { RecordingRow } from '@/src/components/RecordingRow';
import { useMemos } from '@/src/hooks/useMemos';
import { getSession } from '@/src/recording/activeRecordingSession';
import { setRecordingDefaults } from '@/src/settings/appSettings';
import {
  createMemo,
  deleteMemo,
  permanentlyDeleteMemo,
  recoverMemo,
  type MemoListScope,
} from '@/src/storage/memoStore';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type RecordingsListLayoutMode = 'stack' | 'sidebar';

export type RecordingsListProps = {
  scope: MemoListScope;
  folderId?: string;
  /** List screen title (sidebar header / navigation). */
  title?: string;
  backTitle?: string;
  showRecordButton?: boolean;
  allowMoveToFolder?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
  headerExtraActions?: ReactNode;
  layoutMode?: RecordingsListLayoutMode;
  selectedMemoId?: string | null;
  onSelectMemo?: (memoId: string | null, options?: { autoRecord?: boolean }) => void;
};

export function RecordingsList({
  scope,
  folderId,
  title,
  backTitle = 'Back',
  showRecordButton = true,
  allowMoveToFolder = true,
  emptyTitle = 'No Recordings',
  emptySubtitle = 'Tap the red button to record your first memo.',
  headerExtraActions,
  layoutMode = 'stack',
  selectedMemoId = null,
  onSelectMemo,
}: RecordingsListProps) {
  const colors = useVoiceMemosColors();
  const insets = useSafeAreaInsets();
  const styles = useStyles(colors);
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  const { memos, refresh, removeMemo, removeMemos } = useMemos(scope);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isStartingRecord, setIsStartingRecord] = useState(false);
  const startingRecordRef = useRef(false);
  const isTrash = scope.kind === 'trash';
  const isSidebar = layoutMode === 'sidebar';
  const listTitle = title ?? backTitle;

  const clearStartingRecord = useCallback(() => {
    startingRecordRef.current = false;
    setIsStartingRecord(false);
  }, []);

  // Once recording is active, the isRecording flag keeps the button disabled.
  useEffect(() => {
    if (isRecording && isStartingRecord) {
      clearStartingRecord();
    }
  }, [clearStartingRecord, isRecording, isStartingRecord]);

  // After the sheet closes (list refocuses), re-enable if nothing is recording.
  useFocusEffect(
    useCallback(() => {
      if (!isRecording && !getSession()) {
        clearStartingRecord();
      }
    }, [clearStartingRecord, isRecording])
  );

  const filteredMemos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return memos;
    }
    return memos.filter((memo) => memo.title.toLowerCase().includes(normalized));
  }, [memos, query]);

  const countLabel = `${memos.length} Recording${memos.length === 1 ? '' : 's'}`;

  const toggleSelection = (memoId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(memoId)) {
        next.delete(memoId);
      } else {
        next.add(memoId);
      }
      return next;
    });
  };

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      clearSelection();
      return;
    }
    setSelectionMode(true);
  }, [clearSelection, selectionMode]);

  const handleDeleteFailed = useCallback(() => {
    void refresh();
    Alert.alert('Delete failed', 'The recording could not be deleted. Please try again.');
  }, [refresh]);

  const handleMemoDeleted = useCallback(
    (memoId: string) => {
      setExpandedId((current) => (current === memoId ? null : current));
      setSelectedIds((current) => {
        if (!current.has(memoId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(memoId);
        return next;
      });
      removeMemo(memoId);
      if (selectedMemoId === memoId) {
        onSelectMemo?.(null);
      }
    },
    [onSelectMemo, removeMemo, selectedMemoId]
  );

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      return;
    }
    const count = selectedIds.size;
    Alert.alert(
      isTrash ? 'Delete Recordings' : 'Delete Recordings',
      isTrash
        ? `Permanently delete ${count} recording(s)?`
        : `Delete ${count} recording(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const ids = [...selectedIds];
            memoAudioEngine.unload();
            removeMemos(ids);
            clearSelection();
            if (selectedMemoId && ids.includes(selectedMemoId)) {
              onSelectMemo?.(null);
            }
            const action = isTrash ? permanentlyDeleteMemo : deleteMemo;
            void Promise.all(ids.map((id) => action(id)))
              .then(() => refresh({ silent: true }))
              .catch(() => {
                void refresh();
                Alert.alert(
                  'Delete failed',
                  'Some recordings could not be deleted. Please try again.'
                );
              });
          },
        },
      ]
    );
  };

  const handleRecoverSelected = () => {
    if (selectedIds.size === 0) {
      return;
    }
    void Promise.all([...selectedIds].map((id) => recoverMemo(id))).then(() => {
      memoAudioEngine.unload();
      clearSelection();
      refresh();
    });
  };

  const handleStartRecording = async (settings: RecordFabSettings) => {
    if (startingRecordRef.current || isStartingRecord || isRecording) {
      return;
    }

    startingRecordRef.current = true;
    setIsStartingRecord(true);
    try {
      await setRecordingDefaults({
        precount: settings.precount,
        metronomeEnabled: settings.metronome.enabled,
        bpm: settings.metronome.bpm,
      });
      const memo = await createMemo({
        ...(folderId ? { folderId } : {}),
        precount: settings.precount,
        metronome: settings.metronome,
      });
      if (layoutMode === 'sidebar' && onSelectMemo) {
        await refresh({ silent: true });
        onSelectMemo(memo.id, { autoRecord: true });
        clearStartingRecord();
        return;
      }
      router.push({
        pathname: '/memo/[id]',
        params: { id: memo.id, record: '1', backTitle },
      });
    } catch {
      clearStartingRecord();
    }
  };

  const openEditor = useCallback(
    (memoId: string) => {
      if (layoutMode === 'sidebar' && onSelectMemo) {
        onSelectMemo(memoId);
        return;
      }
      router.push({
        pathname: '/memo/[id]',
        params: { id: memoId, backTitle },
      });
    },
    [backTitle, layoutMode, onSelectMemo]
  );

  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    setIsSearchActive(false);
  }, []);

  const handleSearchPress = useCallback(() => {
    setIsSearchActive(true);
  }, []);

  const headerRightActions = (
    <>
      <FloatingHeaderButton
        accessibilityLabel="Search recordings"
        icon="magnifyingglass"
        onPress={handleSearchPress}
      />
      <FloatingHeaderButton
        accessibilityLabel={selectionMode ? 'Done selecting' : 'Select recordings'}
        label={selectionMode ? 'Done' : 'Select'}
        variant="pill"
        onPress={toggleSelectionMode}
      />
      {headerExtraActions}
    </>
  );

  const headerScreenOptions = useMemo(() => {
    if (isSidebar) {
      return { headerShown: false as const };
    }

    return {
      title: listTitle,
      headerLargeTitle: true as const,
      headerShown: true as const,
      subtitle: countLabel,
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
                      accessibilityLabel="Search recordings"
                      icon="magnifyingglass"
                      onPress={handleSearchPress}
                    />
                  ),
                },
                {
                  type: 'custom' as const,
                  hidesSharedBackground: true,
                  sharesBackground: false,
                  element: (
                    <FloatingHeaderButton
                      accessibilityLabel={
                        selectionMode ? 'Done selecting' : 'Select recordings'
                      }
                      label={selectionMode ? 'Done' : 'Select'}
                      variant="pill"
                      onPress={toggleSelectionMode}
                    />
                  ),
                },
              ];

              if (isValidElement(headerExtraActions)) {
                items.push({
                  type: 'custom',
                  hidesSharedBackground: true,
                  sharesBackground: false,
                  element: headerExtraActions as ReactElement,
                });
              }

              return items;
            },
          }
        : {
            headerRight: () => (
              <View style={styles.headerActions}>{headerRightActions}</View>
            ),
          }),
    };
  }, [
    countLabel,
    handleSearchPress,
    headerExtraActions,
    isSidebar,
    listTitle,
    selectionMode,
    styles.headerActions,
    toggleSelectionMode,
  ]);

  const listBody = (
    <>
      {isSidebar ? (
        <View style={styles.sidebarHeader}>
          <View style={styles.sidebarToolbar}>
            <FloatingHeaderButton
              accessibilityLabel="Go back"
              icon="chevron.left"
              onPress={() => router.back()}
            />
            <View style={styles.sidebarActions}>{headerRightActions}</View>
          </View>
          <Text numberOfLines={1} style={styles.sidebarTitle}>
            {listTitle}
          </Text>
          <Text style={styles.sidebarCaption}>{countLabel}</Text>
        </View>
      ) : null}

      {isSearchActive ? (
        <View style={styles.searchRow}>
          <TextInput
            autoFocus
            clearButtonMode="while-editing"
            placeholder="Search"
            placeholderTextColor={colors.secondaryText}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
          />
          <Pressable
            accessibilityLabel="Close search"
            hitSlop={8}
            onPress={dismissSearch}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill' }}
              size={22}
              tintColor={colors.secondaryText}
            />
          </Pressable>
        </View>
      ) : null}

      {selectionMode && selectedIds.size > 0 ? (
        <View style={styles.selectionBar}>
          {isTrash ? (
            <Pressable onPress={handleRecoverSelected} style={styles.selectionAction}>
              <SymbolView name={{ ios: 'arrow.uturn.backward' }} size={18} tintColor={colors.accent} />
              <Text style={styles.recoverText}>Recover ({selectedIds.size})</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={handleDeleteSelected} style={styles.selectionAction}>
            <SymbolView name={{ ios: 'trash' }} size={18} tintColor={colors.recordRed} />
            <Text style={styles.deleteText}>Delete ({selectedIds.size})</Text>
          </Pressable>
        </View>
      ) : null}

      <Animated.FlatList
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={filteredMemos}
        itemLayoutAnimation={LIST_ITEM_TRANSITION}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RecordingRow
            active={selectedMemoId === item.id}
            allowMoveToFolder={allowMoveToFolder && !isTrash}
            expanded={layoutMode === 'stack' && expandedId === item.id}
            isTrash={isTrash}
            memo={item}
            selectOnPress={layoutMode === 'sidebar'}
            selected={selectedIds.has(item.id)}
            selectionMode={selectionMode}
            onDeleteFailed={handleDeleteFailed}
            onDeleted={handleMemoDeleted}
            onOpenEditor={() => openEditor(item.id)}
            onToggleExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
            onToggleSelect={() => toggleSelection(item.id)}
            onUpdated={() => void refresh({ silent: true })}
          />
        )}
      />

      {showRecordButton && !selectionMode ? (
        <RecordFabCluster
          bottomOffset={32 + (isSidebar ? 0 : insets.bottom)}
          disabled={isStartingRecord || isRecording}
          onRecord={(settings) => void handleStartRecording(settings)}
        />
      ) : null}
    </>
  );

  return (
    <>
      <Stack.Screen options={headerScreenOptions} />
      {isSidebar ? (
        <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
          {listBody}
        </SafeAreaView>
      ) : (
        // Plain View: SafeAreaView (RN or context) fights headerLargeTitle and causes a vertical title jump.
        <View style={styles.screen}>{listBody}</View>
      )}
    </>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: colors.background,
        },
        sidebarHeader: {
          paddingHorizontal: 12,
          paddingTop: 4,
          paddingBottom: 8,
          gap: 4,
        },
        sidebarToolbar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
        },
        sidebarActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexShrink: 1,
        },
        sidebarTitle: {
          fontSize: 28,
          fontWeight: '700',
          color: colors.text,
          paddingHorizontal: 4,
        },
        sidebarCaption: {
          fontSize: 15,
          color: colors.secondaryText,
          paddingHorizontal: 4,
          paddingBottom: 4,
        },
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        searchRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
        },
        searchInput: {
          flex: 1,
          backgroundColor: colors.searchFieldBackground,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 16,
          color: colors.text,
        },
        selectionBar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          paddingHorizontal: 16,
          paddingBottom: 8,
        },
        selectionAction: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        deleteText: {
          color: colors.recordRed,
          fontSize: 16,
        },
        recoverText: {
          color: colors.accent,
          fontSize: 16,
        },
        listContent: {
          paddingBottom: 120,
        },
        list: {
          flex: 1,
        },
        empty: {
          padding: 32,
          alignItems: 'center',
          gap: 8,
        },
        emptyTitle: {
          fontSize: 20,
          fontWeight: '600',
          color: colors.text,
        },
        emptySubtitle: {
          fontSize: 15,
          color: colors.secondaryText,
          textAlign: 'center',
        },
      }),
    [colors]
  );
}
