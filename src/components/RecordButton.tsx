import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  size?: number;
};

export function RecordButton({ onPress, disabled, size = 72 }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record"
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => [
        styles.wrapper,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={[styles.inner, { width: size - 16, height: size - 16, borderRadius: (size - 16) / 2 }]} />
    </Pressable>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        wrapper: {
          backgroundColor: colors.recordRed,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        },
        inner: {
          backgroundColor: colors.recordRed,
          borderWidth: 4,
          borderColor: '#FFFFFF',
        },
      }),
    [colors]
  );
}
