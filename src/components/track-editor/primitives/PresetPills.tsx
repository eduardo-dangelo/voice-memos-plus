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
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 2,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: VoiceMemosColors.waveformBandBackground,
  },
  pillSelected: {
    backgroundColor: VoiceMemosColors.accent,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: VoiceMemosColors.text,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});
