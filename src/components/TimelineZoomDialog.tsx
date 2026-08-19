import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { NumericDragInput } from './track-editor/primitives/NumericDragInput';

const useGlass = isGlassEffectAPIAvailable();

export type TimelineZoomDialogProps = {
  visible: boolean;
  x: number;
  y: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  onChangeX: (x: number) => void;
  onChangeY: (y: number) => void;
  onReset: () => void;
  onClose: () => void;
  processing?: boolean;
};

export function TimelineZoomDialog({
  visible,
  x,
  y,
  xMin,
  xMax,
  yMin,
  yMax,
  onChangeX,
  onChangeY,
  onReset,
  onClose,
  processing = false,
}: TimelineZoomDialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const showVertical = yMax > 1;
  const [pendingReset, setPendingReset] = useState(false);
  const resetStartedRef = useRef(false);

  useEffect(() => {
    if (visible) {
      return;
    }
    resetStartedRef.current = false;
    setPendingReset(false);
  }, [visible]);

  useEffect(() => {
    if (!processing) {
      setPendingReset(false);
    }
  }, [processing]);

  useEffect(() => {
    if (!pendingReset || processing) {
      return;
    }
    const timeout = setTimeout(() => setPendingReset(false), 400);
    return () => clearTimeout(timeout);
  }, [pendingReset, processing]);

  const showSpinner = pendingReset || processing;

  useEffect(() => {
    if (!visible || !resetStartedRef.current) {
      return;
    }
    if (showSpinner) {
      return;
    }
    resetStartedRef.current = false;
    onClose();
  }, [visible, showSpinner, onClose]);

  const body = (
    <>
      <Text style={styles.title}>Timeline Zoom</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Horizontal</Text>
        <View style={styles.controls}>
          <NumericDragInput
            accessibilityLabel="Horizontal zoom"
            decimals={1}
            max={xMax}
            min={xMin}
            value={x}
            onChange={onChangeX}
            onCommit={onChangeX}
          />
          <Text style={styles.suffix}>×</Text>
        </View>
      </View>

      {showVertical ? (
        <View style={styles.pillRow}>
          <Text style={styles.pillRowLabel}>Vertical</Text>
          <View style={styles.controls}>
            <NumericDragInput
              accessibilityLabel="Vertical zoom"
              max={yMax}
              min={yMin}
              value={y}
              onChange={onChangeY}
              onCommit={onChangeY}
            />
            <Text style={styles.suffix}>×</Text>
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="Reset zoom"
        accessibilityRole="button"
        accessibilityState={{ disabled: showSpinner }}
        disabled={showSpinner}
        hitSlop={8}
        style={[styles.resetButton, showSpinner && styles.resetButtonDisabled]}
        onPress={() => {
          resetStartedRef.current = true;
          setPendingReset(true);
          onReset();
        }}>
        <View style={styles.resetButtonContent}>
          <View style={styles.resetSpinnerSlot} />
          <Text style={styles.resetButtonText}>Reset zoom</Text>
          <View style={styles.resetSpinnerSlot}>
            {showSpinner ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : null}
          </View>
        </View>
      </Pressable>
    </>
  );

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onClose}>
        <Pressable style={styles.cardPressable} onPress={() => {}}>
          {useGlass ? (
            <GlassView
              colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
              glassEffectStyle="regular"
              isInteractive
              style={styles.cardGlass}>
              {body}
            </GlassView>
          ) : (
            <View style={styles.cardFallback}>{body}</View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
          maxWidth: 340,
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
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.45 : 0.18,
          shadowRadius: 24,
          elevation: 8,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
        },
        pillRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        pillRowLabel: {
          width: 78,
          fontSize: 13,
          color: colors.secondaryText,
        },
        controls: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
        },
        suffix: {
          width: 16,
          fontSize: 15,
          fontWeight: '600',
          color: colors.secondaryText,
        },
        resetButton: {
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: colors.waveformInactive,
        },
        resetButtonDisabled: {
          opacity: 0.7,
        },
        resetButtonContent: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        resetSpinnerSlot: {
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
        },
        resetButtonText: {
          fontSize: 15,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
