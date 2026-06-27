import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LayerEffects } from '@/src/audio/layerEffects';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EditorSlider } from '../primitives/EditorSlider';

type Props = {
  effects: LayerEffects;
  onChange: (volumeDb: number) => void;
};

export function VolumeEditor({ effects, onChange }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <View style={styles.container}>
      <EditorSlider
        maximumValue={24}
        minimumValue={-24}
        showCenterTick
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

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
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
          color: colors.secondaryText,
        },
      }),
    [colors]
  );
}
