import { StyleSheet, View } from 'react-native';

import {
  defaultEqFrequencies,
  defaultEqQFactors,
  EQ_PRESETS,
  type EqPreset,
  type LayerEffects,
} from '@/src/audio/layerEffects';

import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['eq']>) => void;
  onRequestCustomEdit?: () => void;
};

const PRESETS: { id: EqPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'voice', label: 'Voice' },
  { id: 'warm', label: 'Warm' },
  { id: 'bright', label: 'Bright' },
  { id: 'bass', label: 'Bass' },
  { id: 'highPass', label: 'High Pass' },
  { id: 'custom', label: 'Custom' },
];

const FLAT_BANDS: LayerEffects['eq']['bands'] = [0, 0, 0, 0, 0];

export function EQEditor({ effects, onChange, onRequestCustomEdit }: Props) {
  const { eq } = effects;
  const { bands, frequencies, qFactors, preset } = eq;

  const handlePreset = (nextPreset: EqPreset) => {
    if (nextPreset === 'off') {
      onChange({
        preset: 'off',
        bands: FLAT_BANDS,
        frequencies: defaultEqFrequencies(),
        qFactors: defaultEqQFactors(),
      });
      return;
    }
    if (nextPreset === 'custom') {
      if (preset === 'off') {
        onChange({
          preset: 'custom',
          bands: FLAT_BANDS,
          frequencies: defaultEqFrequencies(),
          qFactors: defaultEqQFactors(),
        });
      } else {
        onChange({
          preset: 'custom',
          bands,
          frequencies,
          qFactors,
        });
      }
      onRequestCustomEdit?.();
      return;
    }
    onChange({
      preset: nextPreset,
      bands: [...EQ_PRESETS[nextPreset]] as LayerEffects['eq']['bands'],
      frequencies: defaultEqFrequencies(),
      qFactors: defaultEqQFactors(),
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={preset} onSelect={handlePreset} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  presetRow: {
    alignItems: 'center',
  },
});
