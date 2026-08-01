import { StyleSheet, View } from 'react-native';

import {
  getDelayPresetDefaults,
  type DelayPreset,
  type LayerEffects,
} from '@/src/audio/layerEffects';

import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['delay']>) => void;
  onRequestCustomEdit?: () => void;
};

const PRESETS: { id: DelayPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'slap', label: 'Slap' },
  { id: 'echo', label: 'Echo' },
  { id: 'eighth', label: '1/8' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'quarter', label: '1/4' },
  { id: 'half', label: '1/2' },
  { id: 'full', label: '1/1' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'custom', label: 'Custom' },
];

const CUSTOM_DEFAULTS = { timeMs: 320, mix: 25, feedback: 40, sync: 'off' as const };

export function DelayEditor({ effects, onChange, onRequestCustomEdit }: Props) {
  const { delay } = effects;

  const handlePreset = (preset: DelayPreset) => {
    if (preset === 'off') {
      onChange({ preset, mix: 0 });
      return;
    }
    if (preset === 'custom') {
      if (delay.preset === 'off') {
        onChange({ preset: 'custom', ...CUSTOM_DEFAULTS });
      } else {
        onChange({
          preset: 'custom',
          sync: delay.sync,
          timeMs: delay.timeMs,
          mix: delay.mix,
          feedback: delay.feedback,
        });
      }
      onRequestCustomEdit?.();
      return;
    }
    onChange({ preset, ...getDelayPresetDefaults(preset) });
  };

  return (
    <View style={styles.container}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={delay.preset} onSelect={handlePreset} />
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
