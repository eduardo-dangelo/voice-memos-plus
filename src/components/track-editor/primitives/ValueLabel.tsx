import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  value: string;
  size?: 'large' | 'medium';
  onDoublePress?: () => void;
};

export function ValueLabel({ value, size = 'medium' }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.value, size === 'large' && styles.valueLarge]}>{value}</Text>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          alignItems: 'center',
        },
        value: {
          fontSize: 15,
          fontWeight: '500',
          color: colors.text,
          fontVariant: ['tabular-nums'],
        },
        valueLarge: {
          fontSize: 34,
          fontWeight: '300',
        },
      }),
    [colors]
  );
}
