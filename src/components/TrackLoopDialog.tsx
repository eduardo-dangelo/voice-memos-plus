import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const MIN_LOOP_COUNT = 1;
const MAX_LOOP_COUNT = 64;
const useGlass = isGlassEffectAPIAvailable();

export type TrackLoopDialogProps = {
  visible: boolean;
  initialCount: number;
  trackLabel?: string;
  onCancel: () => void;
  /** Applied immediately on each +/- change. */
  onChange: (count: number) => void;
};

function clampLoopCount(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_LOOP_COUNT;
  }
  return Math.max(MIN_LOOP_COUNT, Math.min(MAX_LOOP_COUNT, Math.round(value)));
}

export function TrackLoopDialog({
  visible,
  initialCount,
  trackLabel,
  onCancel,
  onChange,
}: TrackLoopDialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const [count, setCount] = useState(() => clampLoopCount(initialCount));

  useEffect(() => {
    if (visible) {
      setCount(clampLoopCount(initialCount));
    }
  }, [visible, initialCount]);

  const applyCount = (next: number) => {
    const clamped = clampLoopCount(next);
    setCount(clamped);
    onChange(clamped);
  };

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onCancel}>
      <Pressable
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onCancel}>
        <DialogCard styles={styles} colorScheme={colorScheme}>
          <Text style={styles.title}>Loop track</Text>
          {trackLabel ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {trackLabel}
            </Text>
          ) : null}

          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease loop count"
              disabled={count <= MIN_LOOP_COUNT}
              hitSlop={8}
              style={[styles.stepperButton, count <= MIN_LOOP_COUNT && styles.stepperDisabled]}
              onPress={() => applyCount(count - 1)}>
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.countText}>{count}×</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase loop count"
              disabled={count >= MAX_LOOP_COUNT}
              hitSlop={8}
              style={[styles.stepperButton, count >= MAX_LOOP_COUNT && styles.stepperDisabled]}
              onPress={() => applyCount(count + 1)}>
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
          </View>
        </DialogCard>
      </Pressable>
    </Modal>
  );
}

function DialogCard({
  styles,
  colorScheme,
  children,
}: {
  styles: ReturnType<typeof useStyles>;
  colorScheme: 'light' | 'dark' | null | undefined;
  children: ReactNode;
}) {
  return (
    <Pressable style={styles.cardPressable} onPress={() => {}}>
      {useGlass ? (
        <GlassView
          colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
          glassEffectStyle="regular"
          isInteractive
          style={styles.cardGlass}>
          {children}
        </GlassView>
      ) : (
        <View style={styles.cardFallback}>{children}</View>
      )}
    </Pressable>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const cardSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

  return useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: colors.overlayBackground,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        },
        backdropGlass: {
          backgroundColor:
            colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.22)',
        },
        cardPressable: {
          width: '100%',
          maxWidth: 280,
        },
        cardGlass: {
          borderRadius: 20,
          paddingHorizontal: 20,
          paddingVertical: 18,
          gap: 14,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: 20,
          paddingHorizontal: 20,
          paddingVertical: 18,
          gap: 14,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        subtitle: {
          marginTop: -6,
          fontSize: 13,
          color: colors.secondaryText,
          textAlign: 'center',
        },
        stepperRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          paddingVertical: 4,
        },
        stepperButton: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.pillBackground,
        },
        stepperDisabled: {
          opacity: 0.35,
        },
        stepperButtonText: {
          fontSize: 28,
          fontWeight: '500',
          color: colors.text,
          lineHeight: 32,
        },
        countText: {
          minWidth: 64,
          fontSize: 28,
          fontWeight: '700',
          color: colors.text,
          textAlign: 'center',
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
