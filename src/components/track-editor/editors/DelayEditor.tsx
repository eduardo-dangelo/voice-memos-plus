import { StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { syncDelayTimeMs, type DelaySync, type LayerEffects } from '@/src/audio/layerEffects';

import { EditorSlider } from '../primitives/EditorSlider';
import { PresetPills } from '../primitives/PresetPills';

type Props = {
  effects: LayerEffects;
  onChange: (partial: Partial<LayerEffects['delay']>) => void;
};

const SYNC_OPTIONS: { id: DelaySync; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: '1/8', label: '1/8' },
  { id: '1/4', label: '1/4' },
  { id: '1/2', label: '1/2' },
  { id: '1/1', label: '1/1' },
];

export function DelayEditor({ effects, onChange }: Props) {
  const { delay } = effects;
  const displayTimeMs = delay.sync === 'off' ? delay.timeMs : syncDelayTimeMs(delay.sync);

  const handleSync = (sync: DelaySync) => {
    if (sync === 'off') {
      onChange({ sync });
      return;
    }
    onChange({ sync, timeMs: syncDelayTimeMs(sync) });
  };

  return (
    <View style={styles.container}>
      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Sync</Text>
        <PresetPills options={SYNC_OPTIONS} selectedId={delay.sync} onSelect={handleSync} />
      </View>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Time</Text>
        <View style={[styles.sliderTrack, delay.sync !== 'off' && styles.sliderTrackLocked]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncLabel: {
    fontSize: 13,
    color: VoiceMemosColors.secondaryText,
    width: 36,
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
  sliderTrackLocked: {
    opacity: 0.45,
  },
  sliderValue: {
    width: 52,
    fontSize: 12,
    color: VoiceMemosColors.secondaryText,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
