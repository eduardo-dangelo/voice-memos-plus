import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type IconActionSheetItem = {
  id: string;
  title: string;
  systemImage?: string;
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  actions: IconActionSheetItem[];
  onSelect: (actionId: string) => void;
  onDismiss: () => void;
};

export function IconActionSheet({ visible, actions, onSelect, onDismiss }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onDismiss}>
      <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              style={styles.row}
              onPress={() => {
                onDismiss();
                onSelect(action.id);
              }}>
              {action.systemImage ? (
                <SymbolView
                  name={{ ios: action.systemImage as SFSymbol }}
                  size={20}
                  tintColor={action.destructive ? colors.recordRed : colors.text}
                />
              ) : null}
              <Text
                style={[styles.rowLabel, action.destructive && styles.rowLabelDestructive]}>
                {action.title}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.overlayBackground,
          padding: 24,
        },
        card: {
          width: '100%',
          maxWidth: 280,
          backgroundColor: colors.sheetBackground,
          borderRadius: 14,
          overflow: 'hidden',
        },
        row: {
          minHeight: 52,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 10,
        },
        rowLabel: {
          fontSize: 17,
          color: colors.text,
        },
        rowLabelDestructive: {
          color: colors.recordRed,
        },
      }),
    [colors]
  );
}
