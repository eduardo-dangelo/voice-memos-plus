import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const LONG_PRESS_DELAY_MS = 400;

type Props = {
  settings: MetronomeSettings;
  onToggle: () => void;
  onOpenSettings: () => void;
};

export function MetronomeButton({
  settings,
  onToggle,
  onOpenSettings,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const enabled = settings.enabled;

  const handlePress = () => {
    void Haptics.selectionAsync();
    onToggle();
  };

  const handleLongPress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onOpenSettings();
  };

  return (
    <Pressable
      accessibilityHint="Long press to configure tempo and metronome settings"
      accessibilityLabel={enabled ? 'Metronome on' : 'Metronome off'}
      accessibilityRole="button"
      accessibilityState={{ selected: enabled }}
      delayLongPress={LONG_PRESS_DELAY_MS}
      onLongPress={handleLongPress}
      onPress={handlePress}
      style={[styles.button, enabled && styles.buttonEnabled]}>
      <SymbolView
        name={{ ios: enabled ? 'metronome.fill' : 'metronome' }}
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
