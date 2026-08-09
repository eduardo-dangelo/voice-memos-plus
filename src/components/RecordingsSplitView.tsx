import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
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
  const [containerWidth, setContainerWidth] = useState(0);
  const sidebarWidth = useSharedValue(SIDEBAR_WIDTH);
  const sidebarInnerWidth = useSharedValue(SIDEBAR_WIDTH);

  const hasSelection = selected != null;

  const targetSidebarWidth = sidebarCollapsed
    ? 0
    : hasSelection
      ? SIDEBAR_WIDTH
      : containerWidth > 0
        ? containerWidth
        : SIDEBAR_WIDTH;

  useEffect(() => {
    sidebarWidth.value = withTiming(targetSidebarWidth, {
      duration: SIDEBAR_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    // While collapsing to 0, keep the list at SIDEBAR_WIDTH so content clips instead of squashing.
    // Otherwise match the outer sidebar so the list can expand to full width.
    const nextInnerWidth = sidebarCollapsed ? SIDEBAR_WIDTH : targetSidebarWidth;
    sidebarInnerWidth.value = withTiming(nextInnerWidth, {
      duration: SIDEBAR_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [sidebarCollapsed, sidebarInnerWidth, sidebarWidth, targetSidebarWidth]);

  // Any active recording on iPad stays full screen (sidebar collapsed).
  useEffect(() => {
    if (isRecording && !sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  }, [isRecording, sidebarCollapsed]);

  const handleSplitLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    width: sidebarWidth.value,
    opacity: Math.min(1, sidebarWidth.value / SIDEBAR_WIDTH),
  }));

  const sidebarInnerAnimatedStyle = useAnimatedStyle(() => ({
    width: sidebarInnerWidth.value,
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
    if (isRecording) {
      return;
    }
    setSidebarCollapsed((current) => !current);
  }, [isRecording]);

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
    <View style={styles.split} onLayout={handleSplitLayout}>
      <Animated.View
        pointerEvents={sidebarCollapsed ? 'none' : 'auto'}
        style={[styles.sidebar, sidebarAnimatedStyle]}>
        <Animated.View style={[styles.sidebarInner, sidebarInnerAnimatedStyle]}>
          <RecordingsList
            {...props}
            layoutMode="sidebar"
            selectedMemoId={selected?.id ?? null}
            onSelectMemo={handleSelectMemo}
          />
        </Animated.View>
      </Animated.View>
      {selected && !sidebarCollapsed ? <View style={styles.divider} /> : null}
      {selected ? (
        <View style={[styles.detail, { paddingTop: insets.top }]}>
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
        </View>
      ) : null}
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
      }),
    [colors]
  );
}
