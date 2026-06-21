import { Pressable, StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import {
  EQ_FREQUENCIES,
  EQ_PRESETS,
  formatEqBand,
  formatFrequency,
  type LayerEffects,
} from '@/src/audio/layerEffects';

import { EditorSlider } from '../primitives/EditorSlider';
import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (bands: LayerEffects['eq']['bands']) => void;
};

const PRESET_OPTIONS = [
  { id: 'flat', label: 'Flat' },
  { id: 'voice', label: 'Voice' },
  { id: 'warm', label: 'Warm' },
  { id: 'bright', label: 'Bright' },
];

export function EQEditor({ effects, onChange }: Props) {
  const { bands } = effects.eq;

  const updateBand = (index: number, value: number) => {
    const next = [...bands] as LayerEffects['eq']['bands'];
    next[index] = value;
    onChange(next);
  };

  const handlePreset = (presetId: string) => {
    const preset = EQ_PRESETS[presetId];
    if (preset) {
      onChange([...preset] as LayerEffects['eq']['bands']);
    }
  };

  const activePreset =
    PRESET_OPTIONS.find(({ id }) =>
      EQ_PRESETS[id]?.every((value, index) => Math.abs(value - bands[index]) < 0.5)
    )?.id ?? 'flat';

  return (
    <View style={styles.container}>
      <PresetPills
        options={PRESET_OPTIONS}
        selectedId={activePreset}
        onSelect={handlePreset}
      />
      <View style={styles.bandsRow}>
        {bands.map((bandValue, index) => (
          <View key={EQ_FREQUENCIES[index]} style={styles.bandColumn}>
            <Pressable onPress={() => updateBand(index, 0)}>
              <Text style={styles.bandValue}>{formatEqBand(bandValue)}</Text>
            </Pressable>
            <EditorSlider
              maximumValue={12}
              minimumValue={-12}
              orientation="vertical"
              showCenterTick
              snapPoints={[-12, -6, 0, 6, 12]}
              value={bandValue}
              onSlidingComplete={(value) => updateBand(index, value)}
              onValueChange={(value) => updateBand(index, value)}
            />
            <Text style={styles.frequency}>{formatFrequency(EQ_FREQUENCIES[index])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  bandsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  bandColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
  },
  bandValue: {
    fontSize: 11,
    fontWeight: '500',
    color: VoiceMemosColors.text,
    fontVariant: ['tabular-nums'],
    minHeight: 14,
  },
  frequency: {
    fontSize: 10,
    color: VoiceMemosColors.secondaryText,
  },
});
