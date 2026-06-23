import { StyleSheet, View } from 'react-native';

import {
  EQ_PRESETS,
  type EqPreset,
  type LayerEffects,
} from '@/src/audio/layerEffects';

import { EqCurveChart } from '../primitives/EqCurveChart';
import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['eq']>) => void;
};

const PRESETS: { id: EqPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'voice', label: 'Voice' },
  { id: 'warm', label: 'Warm' },
  { id: 'bright', label: 'Bright' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'bass', label: 'Bass' },
  { id: 'treble', label: 'Treble' },
  { id: 'air', label: 'Air' },
  { id: 'muffled', label: 'Muffled' },
  { id: 'custom', label: 'Custom' },
];

const FLAT_BANDS: LayerEffects['eq']['bands'] = [0, 0, 0, 0, 0];

export function EQEditor({ effects, onChange }: Props) {
  const { eq } = effects;
  const { bands, preset } = eq;
  const showBands = preset === 'custom';

  const updateBand = (index: number, value: number) => {
    const next = [...bands] as LayerEffects['eq']['bands'];
    next[index] = value;
    onChange({ bands: next });
  };

  const handlePreset = (nextPreset: EqPreset) => {
    if (nextPreset === 'off') {
      onChange({ preset: 'off', bands: FLAT_BANDS });
      return;
    }
    if (nextPreset === 'custom') {
      if (preset === 'off') {
        onChange({ preset: 'custom', bands: FLAT_BANDS });
      } else {
        onChange({ preset: 'custom', bands });
      }
      return;
    }
    onChange({
      preset: nextPreset,
      bands: [...EQ_PRESETS[nextPreset]] as LayerEffects['eq']['bands'],
    });
  };

  return (
    <View style={[styles.container, !showBands && styles.containerCompact]}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={preset} onSelect={handlePreset} />
      </View>
      {showBands ? (
        <EqCurveChart bands={bands} onChange={updateBand} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  containerCompact: {
    justifyContent: 'center',
  },
  presetRow: {
    alignItems: 'center',
  },
});
