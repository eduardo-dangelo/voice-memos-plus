import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { importMemoFromUri } from '@/src/actions/importMemo';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return Array.isArray(value) ? value[0] : undefined;
}

export default function ImportProjectScreen() {
  const colors = useVoiceMemosColors();
  const { uri } = useLocalSearchParams<{ uri?: string | string[] }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const fileUri = firstParam(uri);
    if (!fileUri) {
      Alert.alert('Import failed', 'The project file could not be opened.');
      router.replace('/');
      return;
    }

    void importMemoFromUri(fileUri)
      .then((memo) => {
        Alert.alert('Imported', `“${memo.title}” was added to your library.`);
        router.replace(`/memo/${memo.id}`);
      })
      .catch((error) => {
        Alert.alert(
          'Import failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
        router.replace('/');
      });
  }, [uri]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={[styles.label, { color: colors.secondaryText }]}>
        Importing project…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  label: {
    fontSize: 16,
  },
});
