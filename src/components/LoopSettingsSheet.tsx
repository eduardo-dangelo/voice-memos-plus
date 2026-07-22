import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { snapTimeToGrid } from '@/src/audio/loopSnap';
import { MIN_LOOP_DURATION } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDurationWithTenths } from '@/src/utils/format';

import { EditorSlider } from './track-editor/primitives/EditorSlider';
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
  const styles = useStyles(colors);
  const maxTime = Math.max(values.duration, MIN_LOOP_DURATION);
  const stepCount = Math.max(1, Math.round(maxTime * 100));

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

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Loop</Text>

          <View style={styles.section}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Start</Text>
              <View style={styles.sliderTrack}>
                <EditorSlider
                  maximumValue={maxTime}
                  minimumValue={0}
                  stepCount={stepCount}
                  value={values.loopStart}
                  onSlidingComplete={applyStart}
                  onValueChange={applyStart}
                />
              </View>
              <Text style={styles.sliderValue}>{formatDurationWithTenths(values.loopStart)}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>End</Text>
              <View style={styles.sliderTrack}>
                <EditorSlider
                  maximumValue={maxTime}
                  minimumValue={0}
                  stepCount={stepCount}
                  value={values.loopEnd}
                  onSlidingComplete={applyEnd}
                  onValueChange={applyEnd}
                />
              </View>
              <Text style={styles.sliderValue}>{formatDurationWithTenths(values.loopEnd)}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Active</Text>
            <PresetPills
              options={TOGGLE_OPTIONS}
              selectedId={values.loopEnabled ? 'on' : 'off'}
              onSelect={(value) => onChange({ loopEnabled: value === 'on' })}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Snap to grid</Text>
            <PresetPills
              options={TOGGLE_OPTIONS}
              selectedId={values.loopSnapToGrid ? 'on' : 'off'}
              onSelect={(value) => onChange({ loopSnapToGrid: value === 'on' })}
            />
            <Text style={styles.sectionCaption}>
              Only available when the metronome is active
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
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
        card: {
          width: '100%',
          maxWidth: 340,
          backgroundColor: colors.background,
          borderRadius: 14,
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
        section: {
          gap: 8,
        },
        sectionLabel: {
          fontSize: 13,
          color: colors.secondaryText,
          textAlign: 'center',
        },
        sectionCaption: {
          fontSize: 12,
          lineHeight: 16,
          color: colors.secondaryText,
          textAlign: 'center',
          opacity: 0.85,
        },
        sliderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        sliderLabel: {
          width: 40,
          fontSize: 13,
          color: colors.secondaryText,
        },
        sliderTrack: {
          flex: 1,
        },
        sliderValue: {
          width: 64,
          fontSize: 12,
          color: colors.secondaryText,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
        },
      }),
    [colors]
  );
}
