import { StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import {
  getDelayPresetDefaults,
  syncDelayTimeMs,
  type DelayPreset,
  type LayerEffects,
} from '@/src/audio/layerEffects';

import { EditorSlider } from '../primitives/EditorSlider';
import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['delay']>) => void;
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

export function DelayEditor({ effects, onChange }: Props) {
  const { delay } = effects;
  const showSliders = delay.preset === 'custom';
  const displayTimeMs = delay.sync === 'off' ? delay.timeMs : syncDelayTimeMs(delay.sync);

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
      return;
    }
    onChange({ preset, ...getDelayPresetDefaults(preset) });
  };

  return (
    <View style={[styles.container, !showSliders && styles.containerCompact]}>
      <View style={styles.presetRow}>
        <PresetPills options={PRESETS} selectedId={delay.preset} onSelect={handlePreset} />
      </View>
      {showSliders ? (
        <>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Time</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={2000}
                minimumValue={50}
                value={displayTimeMs}
                onSlidingComplete={(timeMs) => onChange({ timeMs, sync: 'off' })}
                onValueChange={(timeMs) => onChange({ timeMs, sync: 'off' })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(displayTimeMs)} ms</Text>
          </View>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Mix</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={100}
                minimumValue={0}
                value={delay.mix}
                onSlidingComplete={(mix) => onChange({ mix })}
                onValueChange={(mix) => onChange({ mix })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(delay.mix)}%</Text>
          </View>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Feedback</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={85}
                minimumValue={0}
                value={delay.feedback}
                onSlidingComplete={(feedback) => onChange({ feedback })}
                onValueChange={(feedback) => onChange({ feedback })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(delay.feedback)}%</Text>
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
    width: 56,
    fontSize: 13,
    color: VoiceMemosColors.secondaryText,
  },
  sliderTrack: {
    flex: 1,
  },
  sliderValue: {
    width: 52,
    fontSize: 12,
    color: VoiceMemosColors.secondaryText,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
