import { StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import {
  REVERB_PRESET_DEFAULTS,
  type LayerEffects,
  type ReverbPreset,
} from '@/src/audio/layerEffects';

import { EditorSlider } from '../primitives/EditorSlider';
import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['reverb']>) => void;
};

const PRESETS: { id: ReverbPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'room', label: 'Room' },
  { id: 'hall', label: 'Hall' },
  { id: 'plate', label: 'Plate' },
];

export function ReverbEditor({ effects, onChange }: Props) {
  const { reverb } = effects;

  const handlePreset = (preset: ReverbPreset) => {
    if (preset === 'off') {
      onChange({ preset, mix: 0 });
      return;
    }
    const defaults = REVERB_PRESET_DEFAULTS[preset];
    onChange({ preset, mix: defaults.mix, decay: defaults.decay });
  };

  return (
    <View style={styles.container}>
      <PresetPills options={PRESETS} selectedId={reverb.preset} onSelect={handlePreset} />
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Mix</Text>
        <View style={styles.sliderTrack}>
          <EditorSlider
            maximumValue={100}
            minimumValue={0}
            value={reverb.mix}
            onSlidingComplete={(mix) => onChange({ mix })}
            onValueChange={(mix) => onChange({ mix })}
          />
        </View>
        <Text style={styles.sliderValue}>{Math.round(reverb.mix)}%</Text>
      </View>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Decay</Text>
        <View style={styles.sliderTrack}>
          <EditorSlider
            maximumValue={3}
            minimumValue={0.1}
            value={reverb.decay}
            onSlidingComplete={(decay) => onChange({ decay })}
            onValueChange={(decay) => onChange({ decay })}
          />
        </View>
        <Text style={styles.sliderValue}>{reverb.decay.toFixed(1)}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderLabel: {
    width: 44,
    fontSize: 13,
    color: VoiceMemosColors.secondaryText,
  },
  sliderTrack: {
    flex: 1,
  },
  sliderValue: {
    width: 40,
    fontSize: 12,
    color: VoiceMemosColors.secondaryText,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
