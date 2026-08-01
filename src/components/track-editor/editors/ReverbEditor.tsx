import { StyleSheet, View } from 'react-native';

import {
  REVERB_PRESET_DEFAULTS,
  type LayerEffects,
  type ReverbPreset,
} from '@/src/audio/layerEffects';

import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['reverb']>) => void;
  onRequestCustomEdit?: () => void;
};

const PRESETS: { id: ReverbPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'room', label: 'Room' },
  { id: 'hall', label: 'Hall' },
  { id: 'plate', label: 'Plate' },
  { id: 'chamber', label: 'Chamber' },
  { id: 'cathedral', label: 'Cathedral' },
  { id: 'spring', label: 'Spring' },
  { id: 'custom', label: 'Custom' },
];

const CUSTOM_DEFAULTS = { mix: 14, decay: 1.0 };

export function ReverbEditor({ effects, onChange, onRequestCustomEdit }: Props) {
  const { reverb } = effects;

  const handlePreset = (preset: ReverbPreset) => {
    if (preset === 'off') {
      onChange({ preset, mix: 0 });
      return;
    }
    if (preset === 'custom') {
      if (reverb.preset === 'off') {
        onChange({ preset: 'custom', ...CUSTOM_DEFAULTS });
      } else {
        onChange({ preset: 'custom', mix: reverb.mix, decay: reverb.decay });
      }
      onRequestCustomEdit?.();
      return;
    }
    const defaults = REVERB_PRESET_DEFAULTS[preset];
    onChange({ preset, mix: defaults.mix, decay: defaults.decay });
  };

  return (
    <View style={styles.container}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={reverb.preset} onSelect={handlePreset} />
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
