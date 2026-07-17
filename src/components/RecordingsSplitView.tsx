import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import { MemoEditor } from '@/src/components/MemoEditor';
import { RecordingsList, type RecordingsListProps } from '@/src/components/RecordingsList';
import { useIsRegularWidth } from '@/src/hooks/useIsRegularWidth';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const SIDEBAR_WIDTH = 340;
const SIDEBAR_ANIMATION_MS = 220;

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
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  const [selected, setSelected] = useState<SelectedMemo | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarWidth = useSharedValue(SIDEBAR_WIDTH);

  useEffect(() => {
    sidebarWidth.value = withTiming(sidebarCollapsed ? 0 : SIDEBAR_WIDTH, {
      duration: SIDEBAR_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [sidebarCollapsed, sidebarWidth]);

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    width: sidebarWidth.value,
    opacity: sidebarWidth.value / SIDEBAR_WIDTH,
  }));

  const handleSelectMemo = useCallback(
    (memoId: string | null, options?: { autoRecord?: boolean }) => {
      if (isRecording && selected && memoId !== null && memoId !== selected.id) {
        Alert.alert('Recording in progress', 'Stop or finish recording before opening another memo.');
        return;
      }
      if (!memoId) {
        if (isRecording) {
          Alert.alert('Recording in progress', 'Finish recording before closing the editor.');
          return;
        }
        setSelected(null);
        setSidebarCollapsed(false);
        return;
      }
      if (memoId === selected?.id) {
        setSidebarCollapsed(true);
        return;
      }
      setSelected({ id: memoId, autoRecord: options?.autoRecord ?? false });
      if (options?.autoRecord) {
        setSidebarCollapsed(true);
      }
    },
    [isRecording, selected]
  );

  const handleDismiss = useCallback(() => {
    setSelected(null);
    setSidebarCollapsed(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
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
      <Animated.View
        pointerEvents={sidebarCollapsed ? 'none' : 'auto'}
        style={[styles.sidebar, sidebarAnimatedStyle]}>
        <View style={styles.sidebarInner}>
          <RecordingsList
            {...props}
            layoutMode="sidebar"
            selectedMemoId={selected?.id ?? null}
            onSelectMemo={handleSelectMemo}
          />
        </View>
      </Animated.View>
      {!sidebarCollapsed ? <View style={styles.divider} /> : null}
      <View style={[styles.detail, { paddingTop: insets.top }]}>
        {selected ? (
          <MemoEditor
            key={selected.id}
            autoRecord={selected.autoRecord}
            memoId={selected.id}
            presentation="pane"
            sidebarCollapsed={sidebarCollapsed}
            onAutoRecordConsumed={handleAutoRecordConsumed}
            onDismiss={handleDismiss}
            onMemoIdChange={handleMemoIdChange}
            onToggleSidebar={handleToggleSidebar}
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
          overflow: 'hidden',
          backgroundColor: colors.background,
        },
        sidebarInner: {
          width: SIDEBAR_WIDTH,
          flex: 1,
        },
        divider: {
          width: StyleSheet.hairlineWidth,
          alignSelf: 'stretch',
          backgroundColor: colors.separator,
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
