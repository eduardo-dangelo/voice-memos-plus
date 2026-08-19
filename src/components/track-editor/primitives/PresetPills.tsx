import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props<T extends string> = {
  options: { id: T; label: string }[];
  selectedId: T;
  onSelect: (id: T) => void;
  align?: 'start' | 'end';
  compact?: boolean;
  disabled?: boolean;
};

export function PresetPills<T extends string>({
  options,
  selectedId,
  onSelect,
  align = 'start',
  compact = false,
  disabled = false,
}: Props<T>) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <ScrollView
      horizontal
      style={[styles.scroll, align === 'end' && styles.scrollEnd]}
      contentContainerStyle={[
        styles.row,
        compact && styles.rowCompact,
        align === 'end' && styles.rowEnd,
      ]}
      showsHorizontalScrollIndicator={false}>
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onSelect(option.id)}
            style={[
              styles.pill,
              compact && styles.pillCompact,
              selected && styles.pillSelected,
              disabled && styles.pillDisabled,
            ]}>
            <Text
              style={[
                styles.label,
                compact && styles.labelCompact,
                selected && styles.labelSelected,
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        scroll: {
          flexGrow: 0,
          flexShrink: 1,
        },
        scrollEnd: {
          width: '100%',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 6,
        },
        rowEnd: {
          flexGrow: 1,
          justifyContent: 'flex-end',
          paddingHorizontal: 0,
        },
        rowCompact: {
          gap: 4,
          paddingHorizontal: 0,
        },
        pill: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: colors.waveformBandBackground,
        },
        pillCompact: {
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: 8,
        },
        pillSelected: {
          backgroundColor: colors.accent,
        },
        pillDisabled: {
          opacity: 0.4,
        },
        label: {
          fontSize: 13,
          fontWeight: '500',
          lineHeight: 16,
          includeFontPadding: false,
          color: colors.text,
        },
        labelSelected: {
          color: colors.pillTextSelected,
        },
        labelCompact: {
          fontSize: 12,
          lineHeight: 15,
        },
      }),
    [colors]
  );
}
