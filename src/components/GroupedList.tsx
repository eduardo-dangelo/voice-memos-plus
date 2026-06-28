import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type GroupedListProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  largeTitle?: string;
};

export function GroupedListScreen({ children, style, largeTitle }: GroupedListProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, style]}>
      {largeTitle ? <Text style={styles.largeTitle}>{largeTitle}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function GroupedListSection({ children, style }: GroupedListProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  return <View style={[styles.section, style]}>{children}</View>;
}

type GroupedListSectionHeaderProps = {
  title: string;
};

export function GroupedListSectionHeader({ title }: GroupedListSectionHeaderProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  return <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>;
}

type GroupedListIcon = 'waveform' | 'folder' | 'trash';

type GroupedListRowProps = {
  title: string;
  count?: number;
  showCount?: boolean;
  icon: GroupedListIcon;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
  accessory?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
};

export function GroupedListRow({
  title,
  count = 0,
  showCount = true,
  icon,
  onPress,
  showChevron = true,
  destructive = false,
  accessory,
  isFirst = false,
  isLast = false,
}: GroupedListRowProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isFirst && styles.rowFirst,
        isLast && styles.rowLast,
        pressed && onPress ? styles.rowPressed : null,
      ]}>
      <SymbolView
        name={{ ios: icon }}
        size={22}
        tintColor={destructive ? colors.recordRed : colors.accent}
      />
      <Text style={[styles.rowTitle, destructive && styles.rowTitleDestructive]}>{title}</Text>
      {accessory}
      {showCount ? <Text style={styles.count}>{count}</Text> : null}
      {showChevron && onPress ? (
        <SymbolView name={{ ios: 'chevron.right' }} size={14} tintColor={colors.secondaryText} />
      ) : null}
      {!isLast ? <View style={styles.separator} /> : null}
    </Pressable>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const canvasColor =
    colorScheme === 'dark' ? colors.background : colors.editorCanvasBackground;
  const cellColor = colorScheme === 'dark' ? colors.sheetBackground : colors.background;

  return useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: canvasColor,
        },
        scrollContent: {
          paddingBottom: 32,
        },
        largeTitle: {
          fontSize: 34,
          fontWeight: '700',
          color: colors.text,
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 10,
        },
        section: {
          marginHorizontal: 16,
          marginTop: 12,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: cellColor,
        },
        sectionHeader: {
          marginTop: 22,
          marginBottom: 8,
          marginHorizontal: 32,
          fontSize: 13,
          fontWeight: '400',
          letterSpacing: -0.08,
          color: colors.secondaryText,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 11,
          backgroundColor: cellColor,
          minHeight: 44,
        },
        rowFirst: {
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        },
        rowLast: {
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
        },
        rowPressed: {
          opacity: 0.7,
        },
        rowTitle: {
          flex: 1,
          fontSize: 17,
          color: colors.text,
        },
        rowTitleDestructive: {
          color: colors.recordRed,
        },
        count: {
          fontSize: 17,
          color: colors.secondaryText,
        },
        separator: {
          position: 'absolute',
          left: 50,
          right: 0,
          bottom: 0,
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.separator,
        },
      }),
    [canvasColor, cellColor, colors.separator, colors.secondaryText, colors.text, colors.recordRed, colors.accent]
  );
}
