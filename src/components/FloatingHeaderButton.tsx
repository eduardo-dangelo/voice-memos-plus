import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type FloatingHeaderIcon =
  | 'magnifyingglass'
  | 'ellipsis'
  | 'ellipsis.circle'
  | 'gearshape'
  | 'gearshape.fill'
  | 'folder.badge.plus'
  | 'chevron.left'
  | 'square.and.arrow.up'
  | 'pencil'
  | 'plus.square.on.square'
  | 'trash'
  | 'sidebar.left'
  | 'arrow.up.left.and.arrow.down.right';

export type FloatingHeaderIconSize = 'regular' | 'small';

type BaseProps = {
  onPress: () => void;
  accessibilityLabel: string;
};

type IconProps = BaseProps & {
  variant?: 'icon';
  icon: FloatingHeaderIcon;
  label?: never;
  tintColor?: ColorValue;
  size?: FloatingHeaderIconSize;
};

type PillProps = BaseProps & {
  variant: 'pill';
  label: string;
  icon?: never;
  tintColor?: never;
  size?: never;
};

type Props = IconProps | PillProps;

type IconFaceProps = {
  icon: FloatingHeaderIcon;
  accessibilityLabel?: string;
  tintColor?: ColorValue;
  size?: FloatingHeaderIconSize;
};

const useGlass = isGlassEffectAPIAvailable();

const ICON_SIZE = {
  regular: { button: 44, symbol: 22 },
  small: { button: 32, symbol: 16 },
} as const;

/** Glass icon chrome without a Pressable — for MenuView / other native triggers. */
export function FloatingHeaderIconFace({
  icon,
  accessibilityLabel,
  tintColor,
  size = 'regular',
}: IconFaceProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme, useGlass, size);
  const iconTint = tintColor ?? colors.accent;
  const symbolSize = ICON_SIZE[size].symbol;
  const content = <SymbolView name={{ ios: icon }} size={symbolSize} tintColor={iconTint} />;

  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.iconPressable}>
      {useGlass ? (
        <GlassView isInteractive glassEffectStyle="regular" style={styles.iconGlass}>
          {content}
        </GlassView>
      ) : (
        <View style={styles.iconFallback}>{content}</View>
      )}
    </View>
  );
}

export function FloatingHeaderButton({
  onPress,
  accessibilityLabel,
  variant = 'icon',
  icon,
  label,
  tintColor,
  size = 'regular',
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme, useGlass, size);

  if (variant === 'pill' || !icon) {
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

  return (
    <Pressable accessibilityLabel={accessibilityLabel} hitSlop={8} onPress={onPress}>
      <FloatingHeaderIconFace icon={icon} size={size} tintColor={tintColor} />
    </Pressable>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined,
  glass: boolean,
  size: FloatingHeaderIconSize
) {
  const buttonSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;
  const buttonSize = ICON_SIZE[size].button;
  const radius = buttonSize / 2;

  return useMemo(
    () =>
      StyleSheet.create({
        iconPressable: {
          width: buttonSize,
          height: buttonSize,
          borderRadius: radius,
        },
        iconGlass: {
          width: buttonSize,
          height: buttonSize,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
        },
        iconFallback: {
          width: buttonSize,
          height: buttonSize,
          borderRadius: radius,
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
    [buttonSize, buttonSurface, colorScheme, colors.accent, glass, radius]
  );
}
