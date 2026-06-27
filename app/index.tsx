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
import { createMemo, deleteMemo } from '@/src/storage/memoStore';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export default function RecordingsListScreen() {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const { memos, refresh } = useMemos();
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      return;
    }
    Alert.alert('Delete Recordings', `Delete ${selectedIds.size} recording(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void Promise.all([...selectedIds].map((id) => deleteMemo(id))).then(() => {
            memoAudioEngine.unload();
            setSelectedIds(new Set());
            setSelectionMode(false);
            refresh();
          });
        },
      },
    ]);
  };

  const handleRecord = async () => {
    const memo = await createMemo();
    router.push({ pathname: '/memo/[id]', params: { id: memo.id, record: '1' } });
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
              setSelectionMode(false);
              setSelectedIds(new Set());
              return;
            }
            setSelectionMode(true);
          }}>
          <Text style={styles.selectText}>{selectionMode ? 'Done' : 'Select'}</Text>
        </Pressable>
      </View>

      {selectionMode && selectedIds.size > 0 ? (
        <Pressable onPress={handleDeleteSelected} style={styles.deleteBar}>
          <SymbolView name={{ ios: 'trash' }} size={18} tintColor={colors.recordRed} />
          <Text style={styles.deleteText}>Delete ({selectedIds.size})</Text>
        </Pressable>
      ) : null}

      <FlatList
        contentContainerStyle={styles.listContent}
        data={filteredMemos}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No Recordings</Text>
            <Text style={styles.emptySubtitle}>Tap the red button to record your first memo.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RecordingRow
            expanded={expandedId === item.id}
            memo={item}
            selected={selectedIds.has(item.id)}
            selectionMode={selectionMode}
            onDeleted={refresh}
            onOpenEditor={() => router.push({ pathname: '/memo/[id]', params: { id: item.id } })}
            onToggleExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
            onToggleSelect={() => toggleSelection(item.id)}
            onUpdated={refresh}
          />
        )}
      />

      {!selectionMode ? (
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
        deleteBar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
        },
        deleteText: {
          color: colors.recordRed,
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
