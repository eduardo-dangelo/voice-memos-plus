import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeOut, ZoomIn } from 'react-native-reanimated';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  visible: boolean;
  count: number | null;
  onCancel: () => void;
  /** Fires when the Modal has finished dismissing (iOS). Used to gate monitor arm. */
  onDismiss?: () => void;
};

/**
 * Full-screen Modal so count numerals always paint above the editor.
 * Callers must wait for onDismiss (with a timeout fallback) before sync
 * monitor-mix arm — arming while this Modal is still up freezes at "1".
 */
export function PrecountOverlay({ visible, count, onCancel, onDismiss }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <Modal
      animationType="none"
      transparent
      visible={visible}
      onDismiss={onDismiss}
      onRequestClose={onCancel}>
      <Pressable
        accessibilityLabel="Cancel precount"
        accessibilityRole="button"
        style={styles.overlay}
        onPress={onCancel}>
        {count !== null ? (
          <Animated.View
            key={count}
            entering={ZoomIn.duration(180).springify().damping(18)}
            exiting={FadeOut.duration(90)}
            pointerEvents="none"
            style={styles.numeralWrap}>
            <Text style={styles.numeral}>{count}</Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
        },
        numeralWrap: {
          alignItems: 'center',
          justifyContent: 'center',
        },
        numeral: {
          fontSize: 120,
          fontWeight: '200',
          color: colors.text,
          fontVariant: ['tabular-nums'],
          textAlign: 'center',
        },
      }),
    [colors]
  );
}
