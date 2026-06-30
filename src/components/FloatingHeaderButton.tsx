import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type FloatingHeaderIcon = 'magnifyingglass' | 'ellipsis.circle';

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

export function FloatingHeaderButton({
  onPress,
  accessibilityLabel,
  variant = 'icon',
  icon,
  label,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);

  if (variant === 'pill') {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPress={onPress}
        style={styles.pill}>
        <Text style={styles.pillText}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={styles.icon}>
      <SymbolView name={{ ios: icon }} size={22} tintColor={colors.accent} />
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
        icon: {
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
        pill: {
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
    [buttonSurface, colorScheme, colors.accent]
  );
}
