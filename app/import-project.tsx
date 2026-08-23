import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { importMemoFromUri } from '@/src/actions/importMemo';
import { showImportSuccess } from '@/src/components/ImportSuccessDialog';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return Array.isArray(value) ? value[0] : undefined;
}

function dismissToHome(): void {
  if (router.canDismiss()) {
    router.dismissAll();
    return;
  }
  router.replace('/');
}

/** Close any prior form sheets, then open a single memo editor. */
function openImportedMemo(memoId: string): void {
  if (router.canDismiss()) {
    router.dismissAll();
    requestAnimationFrame(() => {
      router.push(`/memo/${memoId}`);
    });
    return;
  }
  router.replace(`/memo/${memoId}`);
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
      dismissToHome();
      return;
    }

    void importMemoFromUri(fileUri)
      .then((memo) => {
        // Leave the loading screen immediately. The success dialog must not gate
        // navigation — its Modal can fail to present over a Files open-in flow.
        openImportedMemo(memo.id);
        showImportSuccess({ title: memo.title });
      })
      .catch((error) => {
        Alert.alert(
          'Import failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
        dismissToHome();
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
