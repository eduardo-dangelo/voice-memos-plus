import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type FloatingHeaderIcon =
  | 'magnifyingglass'
  | 'ellipsis.circle'
  | 'gearshape'
  | 'gearshape.fill'
  | 'folder.badge.plus'
  | 'chevron.left';

type BaseProps = {
  onPress: () => void;
  accessibilityLabel: string;
};

type IconProps = BaseProps & {
  variant?: 'icon';
  icon: FloatingHeaderIcon;
  label?: never;
};

type PillProps = BaseProps & {
  variant: 'pill';
  label: string;
  icon?: never;
};

type Props = IconProps | PillProps;

const useGlass = isGlassEffectAPIAvailable();

export function FloatingHeaderButton({
  onPress,
  accessibilityLabel,
  variant = 'icon',
  icon,
  label,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme, useGlass);

  if (variant === 'pill') {
    const content = <Text style={styles.pillText}>{label}</Text>;
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPress={onPress}
        style={styles.pillPressable}>
        {useGlass ? (
          <GlassView isInteractive glassEffectStyle="regular" style={styles.pillGlass}>
            {content}
          </GlassView>
        ) : (
          <View style={styles.pillFallback}>{content}</View>
        )}
      </Pressable>
    );
  }

  const content = <SymbolView name={{ ios: icon }} size={22} tintColor={colors.accent} />;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={styles.iconPressable}>
      {useGlass ? (
        <GlassView isInteractive glassEffectStyle="regular" style={styles.iconGlass}>
          {content}
        </GlassView>
      ) : (
        <View style={styles.iconFallback}>{content}</View>
      )}
    </Pressable>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined,
  glass: boolean
) {
  const buttonSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

  return useMemo(
    () =>
      StyleSheet.create({
        iconPressable: {
          width: 44,
          height: 44,
          borderRadius: 22,
        },
        iconGlass: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
        },
        iconFallback: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: buttonSurface,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colorScheme === 'dark' ? 0.35 : 0.12,
          shadowRadius: 4,
          elevation: 3,
        },
        pillPressable: {
          borderRadius: 18,
          minHeight: 36,
          justifyContent: 'center',
        },
        pillGlass: {
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 7,
          minHeight: 36,
          justifyContent: 'center',
          alignItems: 'center',
        },
        pillFallback: {
          backgroundColor: buttonSurface,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 7,
          minHeight: 36,
          justifyContent: 'center',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colorScheme === 'dark' ? 0.35 : 0.12,
          shadowRadius: 4,
          elevation: 3,
        },
        pillText: {
          color: colors.accent,
          fontSize: 16,
          fontWeight: '400',
        },
      }),
    [buttonSurface, colorScheme, colors.accent, glass]
  );
}
