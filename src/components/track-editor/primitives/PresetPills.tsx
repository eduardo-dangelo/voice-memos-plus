import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

type Props<T extends string> = {
  options: { id: T; label: string }[];
  selectedId: T;
  onSelect: (id: T) => void;
};

export function PresetPills<T extends string>({ options, selectedId, onSelect }: Props<T>) {
  return (
    <ScrollView
      horizontal
      style={styles.scroll}
      contentContainerStyle={styles.row}
      showsHorizontalScrollIndicator={false}>
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            style={[styles.pill, selected && styles.pillSelected]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: VoiceMemosColors.waveformBandBackground,
  },
  pillSelected: {
    backgroundColor: VoiceMemosColors.accent,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 16,
    includeFontPadding: false,
    color: VoiceMemosColors.text,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});
