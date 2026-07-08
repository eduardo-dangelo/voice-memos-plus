import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MetronomeSettings, TimeSignaturePreset } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EditorSlider } from './track-editor/primitives/EditorSlider';
import { PresetPills } from './track-editor/primitives/PresetPills';

type Props = {
  visible: boolean;
  settings: MetronomeSettings;
  onChange: (partial: Partial<MetronomeSettings>) => void;
  onClose: () => void;
};

const TIME_SIGNATURE_OPTIONS: { id: TimeSignaturePreset; label: string }[] = [
  { id: '4/4', label: '4/4' },
  { id: '3/4', label: '3/4' },
  { id: '2/4', label: '2/4' },
  { id: '6/8', label: '6/8' },
  { id: '5/4', label: '5/4' },
];

const ACCENT_OPTIONS: { id: 'on' | 'off'; label: string }[] = [
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

export function MetronomeSettingsSheet({ visible, settings, onChange, onClose }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Metronome</Text>

          <View style={styles.section}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Tempo</Text>
              <View style={styles.sliderTrack}>
                <EditorSlider
                  maximumValue={240}
                  minimumValue={40}
                  stepCount={200}
                  value={settings.bpm}
                  onSlidingComplete={(bpm) => onChange({ bpm })}
                  onValueChange={(bpm) => onChange({ bpm })}
                />
              </View>
              <Text style={styles.sliderValue}>{Math.round(settings.bpm)}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Time signature</Text>
            <PresetPills
              options={TIME_SIGNATURE_OPTIONS}
              selectedId={settings.timeSignature}
              onSelect={(timeSignature) => onChange({ timeSignature })}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Accent</Text>
            <PresetPills
              options={ACCENT_OPTIONS}
              selectedId={settings.accentEnabled ? 'on' : 'off'}
              onSelect={(value) => onChange({ accentEnabled: value === 'on' })}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Volume</Text>
              <View style={styles.sliderTrack}>
                <EditorSlider
                  maximumValue={100}
                  minimumValue={0}
                  value={settings.volume}
                  onSlidingComplete={(volume) => onChange({ volume })}
                  onValueChange={(volume) => onChange({ volume })}
                />
              </View>
              <Text style={styles.sliderValue}>{Math.round(settings.volume)}%</Text>
            </View>
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
        sliderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        sliderLabel: {
          width: 56,
          fontSize: 13,
          color: colors.secondaryText,
        },
        sliderTrack: {
          flex: 1,
        },
        sliderValue: {
          width: 52,
          fontSize: 12,
          color: colors.secondaryText,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
        },
      }),
    [colors]
  );
}
