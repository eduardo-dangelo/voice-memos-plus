import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { memoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { RecordButton } from '@/src/components/RecordButton';
import { RecordingRow } from '@/src/components/RecordingRow';
import { useMemos } from '@/src/hooks/useMemos';
import {
  createMemo,
  deleteMemo,
  permanentlyDeleteMemo,
  recoverMemo,
  type MemoListScope,
} from '@/src/storage/memoStore';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  scope: MemoListScope;
  folderId?: string;
  backTitle?: string;
  showRecordButton?: boolean;
  allowMoveToFolder?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
};

export function RecordingsList({
  scope,
  folderId,
  backTitle = 'Back',
  showRecordButton = true,
  allowMoveToFolder = true,
  emptyTitle = 'No Recordings',
  emptySubtitle = 'Tap the red button to record your first memo.',
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const { memos, refresh } = useMemos(scope);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isTrash = scope.kind === 'trash';

  const filteredMemos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return memos;
    }
    return memos.filter((memo) => memo.title.toLowerCase().includes(normalized));
  }, [memos, query]);

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

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

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
            const action = isTrash ? permanentlyDeleteMemo : deleteMemo;
            void Promise.all([...selectedIds].map((id) => action(id))).then(() => {
              memoAudioEngine.unload();
              clearSelection();
              refresh();
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

  const handleRecord = async () => {
    const memo = await createMemo(folderId ? { folderId } : undefined);
    router.push({
      pathname: '/memo/[id]',
      params: { id: memo.id, record: '1', backTitle },
    });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          clearButtonMode="while-editing"
          placeholder="Search"
          placeholderTextColor={colors.secondaryText}
          style={styles.search}
          value={query}
          onChangeText={setQuery}
        />
        <Pressable
          onPress={() => {
            if (selectionMode) {
              clearSelection();
              return;
            }
            setSelectionMode(true);
          }}>
          <Text style={styles.selectText}>{selectionMode ? 'Done' : 'Select'}</Text>
        </Pressable>
      </View>

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

      <FlatList
        contentContainerStyle={styles.listContent}
        data={filteredMemos}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RecordingRow
            allowMoveToFolder={allowMoveToFolder && !isTrash}
            expanded={expandedId === item.id}
            isTrash={isTrash}
            memo={item}
            selected={selectedIds.has(item.id)}
            selectionMode={selectionMode}
            onDeleted={refresh}
            onOpenEditor={() =>
              router.push({
                pathname: '/memo/[id]',
                params: { id: item.id, backTitle },
              })
            }
            onToggleExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
            onToggleSelect={() => toggleSelection(item.id)}
            onUpdated={refresh}
          />
        )}
      />

      {showRecordButton && !selectionMode ? (
        <View pointerEvents="box-none" style={styles.fabContainer}>
          <RecordButton onPress={() => void handleRecord()} />
        </View>
      ) : null}
    </SafeAreaView>
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
        toolbar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingBottom: 8,
        },
        search: {
          flex: 1,
          backgroundColor: colors.searchFieldBackground,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 16,
          color: colors.text,
        },
        selectText: {
          color: colors.accent,
          fontSize: 17,
          fontWeight: '500',
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
        fabContainer: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 32,
          alignItems: 'center',
        },
      }),
    [colors]
  );
}
