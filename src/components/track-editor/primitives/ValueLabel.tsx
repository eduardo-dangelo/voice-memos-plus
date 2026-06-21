import { StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

type Props = {
  value: string;
  size?: 'large' | 'medium';
  onDoublePress?: () => void;
};

export function ValueLabel({ value, size = 'medium' }: Props) {
  return (
    <View style={styles.container}>
      <Text style={[styles.value, size === 'large' && styles.valueLarge]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  value: {
    fontSize: 15,
    fontWeight: '500',
    color: VoiceMemosColors.text,
    fontVariant: ['tabular-nums'],
  },
  valueLarge: {
    fontSize: 34,
    fontWeight: '300',
  },
});
