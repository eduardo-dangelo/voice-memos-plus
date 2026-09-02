import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { NumericDragInput } from './track-editor/primitives/NumericDragInput';

const useGlass = isGlassEffectAPIAvailable();
/** Default NumericDragInput sensitivity (~50px) sweeps full range; horizontal zoom needs finer control. */
const HORIZONTAL_ZOOM_DRAG_SENSITIVITY = 0.5;

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

  const body = (
    <>
      <Text style={styles.title}>Timeline Zoom</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Horizontal</Text>
        <View style={styles.controls}>
          <NumericDragInput
            accessibilityLabel="Horizontal zoom"
            decimals={1}
            gestureSensitivity={HORIZONTAL_ZOOM_DRAG_SENSITIVITY}
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

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Reset zoom"
          accessibilityRole="button"
          accessibilityState={{ disabled: processing }}
          disabled={processing}
          hitSlop={8}
          style={styles.actionButton}
          onPress={onReset}>
          {processing ? (
            <ActivityIndicator color={colors.secondaryText} size="small" />
          ) : (
            <Text style={styles.resetText}>Reset</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="OK"
          accessibilityRole="button"
          hitSlop={8}
          style={styles.actionButton}
          onPress={onClose}>
          <Text style={styles.okText}>OK</Text>
        </Pressable>
      </View>
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
        actions: {
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: 24,
          paddingTop: 2,
        },
        actionButton: {
          paddingVertical: 6,
          minWidth: 44,
          alignItems: 'center',
        },
        resetText: {
          fontSize: 17,
          color: colors.secondaryText,
        },
        okText: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
