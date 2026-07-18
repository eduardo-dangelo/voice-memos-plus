import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const LONG_PRESS_DELAY_MS = 400;
const useGlass = isGlassEffectAPIAvailable();
const BUTTON_SIZE = 32;

type Props = {
  settings: MetronomeSettings;
  onToggle: () => void;
  onOpenSettings: () => void;
  disabled?: boolean;
};

export function MetronomeButton({
  settings,
  onToggle,
  onOpenSettings,
  disabled = false,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const enabled = settings.enabled;
  const iconTint = enabled ? colors.accent : colors.secondaryText;

  const handlePress = () => {
    if (disabled) {
      return;
    }
    void Haptics.selectionAsync();
    onToggle();
  };

  const handleLongPress = () => {
    if (disabled) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onOpenSettings();
  };

  const content = (
    <SymbolView
      name={{ ios: enabled ? 'metronome.fill' : 'metronome' }}
      size={18}
      tintColor={iconTint}
    />
  );

  return (
    <Pressable
      accessibilityHint="Long press to configure tempo and metronome settings"
      accessibilityLabel={enabled ? 'Metronome on' : 'Metronome off'}
      accessibilityRole="button"
      accessibilityState={{ selected: enabled, disabled }}
      delayLongPress={LONG_PRESS_DELAY_MS}
      disabled={disabled}
      onLongPress={handleLongPress}
      onPress={handlePress}
      style={[
        styles.pressable,
        enabled && styles.pressableEnabled,
        disabled && styles.pressableDisabled,
      ]}>
      {useGlass ? (
        <GlassView
          colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
          glassEffectStyle="regular"
          isInteractive={!disabled}
          style={styles.glass}>
          {content}
        </GlassView>
      ) : (
        <View style={styles.fallback}>{content}</View>
      )}
    </Pressable>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const buttonSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

  return useMemo(
    () =>
      StyleSheet.create({
        pressable: {
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_SIZE / 2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'transparent',
        },
        pressableEnabled: {
          borderColor: colors.accent,
        },
        pressableDisabled: {
          opacity: 0.4,
        },
        glass: {
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        fallback: {
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: buttonSurface,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colorScheme === 'dark' ? 0.35 : 0.12,
          shadowRadius: 4,
          elevation: 3,
        },
      }),
    [buttonSurface, colorScheme, colors.accent]
  );
}
