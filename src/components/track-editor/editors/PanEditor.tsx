import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LayerEffects } from '@/src/audio/layerEffects';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EditorSlider } from '../primitives/EditorSlider';

type Props = {
  effects: LayerEffects;
  onChange: (pan: number) => void;
};

export function PanEditor({ effects, onChange }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <View style={styles.container}>
      <EditorSlider
        maximumValue={1}
        minimumValue={-1}
        showCenterTick
        value={effects.pan}
        onSlidingComplete={onChange}
        onValueChange={onChange}
      />
      <View style={styles.labels}>
        <Text style={styles.label}>L</Text>
        <Text style={styles.label}>C</Text>
        <Text style={styles.label}>R</Text>
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
