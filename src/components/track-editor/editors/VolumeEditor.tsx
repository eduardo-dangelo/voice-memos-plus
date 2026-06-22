import { StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import type { LayerEffects } from '@/src/audio/layerEffects';

import { EditorSlider } from '../primitives/EditorSlider';

type Props = {
  effects: LayerEffects;
  onChange: (volumeDb: number) => void;
};

export function VolumeEditor({ effects, onChange }: Props) {
  const snapPoints = [-24, -12, -6, 0, 6, 12, 18, 24];

  return (
    <View style={styles.container}>
      <EditorSlider
        maximumValue={24}
        minimumValue={-24}
        showCenterTick
        snapPoints={snapPoints}
        value={effects.volumeDb}
        onSlidingComplete={onChange}
        onValueChange={onChange}
      />
      <View style={styles.labels}>
        <Text style={styles.label}>Mute</Text>
        <Text style={styles.label}>0</Text>
        <Text style={styles.label}>+24</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  label: {
    fontSize: 11,
    color: VoiceMemosColors.secondaryText,
  },
});
