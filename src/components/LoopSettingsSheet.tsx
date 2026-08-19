import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { snapTimeToGrid } from '@/src/audio/loopSnap';
import { MIN_LOOP_DURATION } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { NumericDragInput } from './track-editor/primitives/NumericDragInput';
import { PresetPills } from './track-editor/primitives/PresetPills';

export type LoopSettingsValues = {
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  loopSnapToGrid: boolean;
  duration: number;
};

type Props = {
  visible: boolean;
  values: LoopSettingsValues;
  /** Beat interval when snap is active; null disables snapping in the sheet. */
  snapIntervalSec?: number | null;
  onChange: (partial: Partial<Omit<LoopSettingsValues, 'duration'>>) => void;
  onClose: () => void;
};

const TOGGLE_OPTIONS: { id: 'on' | 'off'; label: string }[] = [
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

const useGlass = isGlassEffectAPIAvailable();

function clampLoopEdges(
  start: number,
  end: number,
  duration: number,
  snapIntervalSec?: number | null
): { loopStart: number; loopEnd: number } {
  const snap = (time: number) =>
    snapIntervalSec != null && snapIntervalSec > 0
      ? snapTimeToGrid(time, snapIntervalSec, duration)
      : Math.max(0, Math.min(duration, time));

  let loopStart = snap(start);
  let loopEnd = snap(end);
  if (loopEnd <= loopStart + MIN_LOOP_DURATION) {
    loopEnd = Math.min(duration, loopStart + MIN_LOOP_DURATION);
    if (snapIntervalSec != null && snapIntervalSec > 0) {
      loopEnd = snapTimeToGrid(loopEnd, snapIntervalSec, duration);
      if (loopEnd <= loopStart + MIN_LOOP_DURATION) {
        loopEnd = Math.min(duration, loopStart + Math.max(snapIntervalSec, MIN_LOOP_DURATION));
      }
    }
  }
  if (loopEnd <= loopStart + MIN_LOOP_DURATION) {
    loopStart = Math.max(0, loopEnd - MIN_LOOP_DURATION);
  }
  return { loopStart, loopEnd };
}

export function LoopSettingsSheet({
  visible,
  values,
  snapIntervalSec,
  onChange,
  onClose,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const maxTime = Math.max(values.duration, MIN_LOOP_DURATION);

  const applyStart = (raw: number) => {
    const { loopStart, loopEnd } = clampLoopEdges(
      raw,
      values.loopEnd,
      values.duration,
      values.loopSnapToGrid ? snapIntervalSec : null
    );
    onChange({ loopStart, loopEnd });
  };

  const applyEnd = (raw: number) => {
    const { loopStart, loopEnd } = clampLoopEdges(
      values.loopStart,
      raw,
      values.duration,
      values.loopSnapToGrid ? snapIntervalSec : null
    );
    onChange({ loopStart, loopEnd });
  };

  const body = (
    <>
      <Text style={styles.title}>Loop</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Start</Text>
        <View style={styles.controls}>
          <NumericDragInput
            accessibilityLabel="Loop start time"
            decimals={1}
            max={maxTime}
            min={0}
            value={values.loopStart}
            onChange={applyStart}
            onCommit={applyStart}
          />
          <Text style={styles.suffix}>s</Text>
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>End</Text>
        <View style={styles.controls}>
          <NumericDragInput
            accessibilityLabel="Loop end time"
            decimals={1}
            max={maxTime}
            min={0}
            value={values.loopEnd}
            onChange={applyEnd}
            onCommit={applyEnd}
          />
          <Text style={styles.suffix}>s</Text>
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Active</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            options={TOGGLE_OPTIONS}
            selectedId={values.loopEnabled ? 'on' : 'off'}
            onSelect={(value) => onChange({ loopEnabled: value === 'on' })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Snap to grid</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            options={TOGGLE_OPTIONS}
            selectedId={values.loopSnapToGrid ? 'on' : 'off'}
            onSelect={(value) => onChange({ loopSnapToGrid: value === 'on' })}
          />
        </View>
      </View>
      <Text style={styles.sectionCaption}>Only available when the grid is visible</Text>

      <Pressable
        accessibilityLabel="Reset loop"
        accessibilityRole="button"
        hitSlop={8}
        style={styles.resetButton}
        onPress={() => {
          onChange({ loopStart: 0, loopEnd: 0, loopEnabled: false });
          onClose();
        }}>
        <Text style={styles.resetButtonText}>Reset loop</Text>
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
          textAlign: 'center',
        },
        pillRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        pillRowLabel: {
          width: 92,
          fontSize: 13,
          color: colors.secondaryText,
        },
        pillRowPills: {
          flex: 1,
          minWidth: 0,
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
        sectionCaption: {
          fontSize: 12,
          lineHeight: 16,
          color: colors.secondaryText,
          textAlign: 'center',
          opacity: 0.85,
        },
        resetButton: {
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: colors.waveformInactive,
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
