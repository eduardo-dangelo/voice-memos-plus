import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAudioEngineState } from '@/src/audio/AudioEngineContext';
import { MemoEditor } from '@/src/components/MemoEditor';
import { RecordingsList, type RecordingsListProps } from '@/src/components/RecordingsList';
import { useIsRegularWidth } from '@/src/hooks/useIsRegularWidth';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const SIDEBAR_WIDTH = 340;

type SelectedMemo = {
  id: string;
  autoRecord: boolean;
};

type Props = Omit<RecordingsListProps, 'selectedMemoId' | 'onSelectMemo' | 'layoutMode'>;

export function RecordingsSplitView(props: Props) {
  const isRegularWidth = useIsRegularWidth();
  const colors = useVoiceMemosColors();
  const insets = useSafeAreaInsets();
  const styles = useStyles(colors);
  const engineState = useAudioEngineState();
  const [selected, setSelected] = useState<SelectedMemo | null>(null);

  const handleSelectMemo = useCallback(
    (memoId: string | null, options?: { autoRecord?: boolean }) => {
      if (
        engineState.isRecording &&
        selected &&
        memoId !== null &&
        memoId !== selected.id
      ) {
        Alert.alert('Recording in progress', 'Stop or finish recording before opening another memo.');
        return;
      }
      if (!memoId) {
        if (engineState.isRecording) {
          Alert.alert('Recording in progress', 'Finish recording before closing the editor.');
          return;
        }
        setSelected(null);
        return;
      }
      setSelected({ id: memoId, autoRecord: options?.autoRecord ?? false });
    },
    [engineState.isRecording, selected]
  );

  const handleDismiss = useCallback(() => {
    setSelected(null);
  }, []);

  const handleAutoRecordConsumed = useCallback(() => {
    setSelected((current) => (current ? { ...current, autoRecord: false } : null));
  }, []);

  const handleMemoIdChange = useCallback((memoId: string) => {
    setSelected({ id: memoId, autoRecord: false });
  }, []);

  if (!isRegularWidth) {
    return <RecordingsList {...props} layoutMode="stack" />;
  }

  return (
    <View style={styles.split}>
      <View style={styles.sidebar}>
        <RecordingsList
          {...props}
          layoutMode="sidebar"
          selectedMemoId={selected?.id ?? null}
          onSelectMemo={handleSelectMemo}
        />
      </View>
      <View style={[styles.detail, { paddingTop: insets.top }]}>
        {selected ? (
          <MemoEditor
            key={selected.id}
            autoRecord={selected.autoRecord}
            memoId={selected.id}
            presentation="pane"
            onAutoRecordConsumed={handleAutoRecordConsumed}
            onDismiss={handleDismiss}
            onMemoIdChange={handleMemoIdChange}
          />
        ) : (
          <View style={styles.emptyDetail}>
            <Text style={styles.emptyDetailTitle}>No Recording Selected</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        split: {
          flex: 1,
          flexDirection: 'row',
          backgroundColor: colors.background,
        },
        sidebar: {
          width: SIDEBAR_WIDTH,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: colors.separator,
          backgroundColor: colors.background,
        },
        detail: {
          flex: 1,
          backgroundColor: colors.sheetBackground,
        },
        emptyDetail: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
        },
        emptyDetailTitle: {
          fontSize: 22,
          fontWeight: '600',
          color: colors.text,
        },
      }),
    [colors]
  );
}
