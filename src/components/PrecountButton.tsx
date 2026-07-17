import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import type { PrecountMode } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  mode: PrecountMode;
  onCycle: () => void;
};

function accessibilityLabelForMode(mode: PrecountMode): string {
  switch (mode) {
    case 'sound':
      return 'Precount on with sound';
    case 'silent':
      return 'Precount on silent';
    case 'off':
    default:
      return 'Precount off';
  }
}

export function PrecountButton({ mode, onCycle }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const enabled = mode !== 'off';

  const handlePress = () => {
    void Haptics.selectionAsync();
    onCycle();
  };

  return (
    <Pressable
      accessibilityHint="Cycles precount: silent, with sound, then off"
      accessibilityLabel={accessibilityLabelForMode(mode)}
      accessibilityRole="button"
      accessibilityState={{ selected: enabled }}
      onPress={handlePress}
      style={[styles.button, enabled && styles.buttonEnabled]}>
      <SymbolView
        name={{ ios: mode === 'sound' ? '4.circle.fill' : '4.circle' }}
        size={18}
        tintColor={enabled ? colors.accent : colors.secondaryText}
      />
    </Pressable>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        button: {
          width: 32,
          height: 32,
          borderRadius: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          backgroundColor: colors.waveformBandBackground,
          alignItems: 'center',
          justifyContent: 'center',
        },
        buttonEnabled: {
          borderColor: colors.accent,
        },
      }),
    [colors]
  );
}
