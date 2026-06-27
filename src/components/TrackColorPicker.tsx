import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DEFAULT_TRACK_COLOR,
  TRACK_COLOR_OPTIONS,
} from '@/constants/VoiceMemosColors';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type Props = {
  visible: boolean;
  selectedColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
};

export function TrackColorPicker({ visible, selectedColor, onSelect, onClose }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Track Color</Text>
          <View style={styles.swatchRow}>
            {TRACK_COLOR_OPTIONS.map((color) => {
              const isSelected = color === selectedColor;
              return (
                <Pressable
                  key={color}
                  accessibilityLabel={`Select color ${color}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelect(color)}
                  style={[
                    styles.swatchOuter,
                    isSelected && {
                      borderColor: color,
                    },
                  ]}>
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {isSelected ? <View style={styles.swatchCheck} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function resolveTrackColor(color?: string): string {
  return color ?? DEFAULT_TRACK_COLOR;
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: colors.overlayBackground,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        },
        card: {
          width: '100%',
          maxWidth: 320,
          backgroundColor: colors.background,
          borderRadius: 14,
          paddingHorizontal: 20,
          paddingVertical: 18,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          marginBottom: 16,
          textAlign: 'center',
        },
        swatchRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 12,
        },
        swatchOuter: {
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 2,
          borderColor: 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
        swatch: {
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
        },
        swatchCheck: {
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: colors.background,
        },
      }),
    [colors]
  );
}
