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
  { id: 'chamber', label: 'Chamber' },
  { id: 'cathedral', label: 'Cathedral' },
  { id: 'spring', label: 'Spring' },
  { id: 'custom', label: 'Custom' },
];

const CUSTOM_DEFAULTS = { mix: 25, decay: 1.0 };

export function ReverbEditor({ effects, onChange }: Props) {
  const { reverb } = effects;
  const showSliders = reverb.preset === 'custom';

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
      return;
    }
    const defaults = REVERB_PRESET_DEFAULTS[preset];
    onChange({ preset, mix: defaults.mix, decay: defaults.decay });
  };

  return (
    <View style={[styles.container, !showSliders && styles.containerCompact]}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={reverb.preset} onSelect={handlePreset} />
      </View>
      {showSliders ? (
        <>
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
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  containerCompact: {
    justifyContent: 'center',
  },
  presetRow: {
    alignItems: 'center',
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
