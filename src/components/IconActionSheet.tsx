import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type IconActionSheetItem = {
  id: string;
  title: string;
  systemImage?: string;
  destructive?: boolean;
};

export type IconActionSheetRename = {
  title: string;
  initialValue: string;
};

type Props = {
  visible: boolean;
  actions: IconActionSheetItem[];
  /** When set, the same Modal shows a select-all rename form instead of actions. */
  rename?: IconActionSheetRename | null;
  onSelect: (actionId: string) => void;
  onRenameSave?: (value: string) => void;
  onDismiss: () => void;
};

type Selection = NonNullable<TextInputProps['selection']>;

export function IconActionSheet({
  visible,
  actions,
  rename = null,
  onSelect,
  onRenameSave,
  onDismiss,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef(rename?.initialValue ?? '');
  const [value, setValue] = useState(rename?.initialValue ?? '');
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [inputInstance, setInputInstance] = useState(0);

  const renameActive = rename != null;
  valueRef.current = value;

  const selectAllText = useCallback(() => {
    const length = valueRef.current.length;
    setSelection({ start: 0, end: length });
    inputRef.current?.setSelection(0, length);
  }, []);

  useEffect(() => {
    if (!visible || !rename) {
      setSelection(undefined);
      return;
    }
    setValue(rename.initialValue);
    valueRef.current = rename.initialValue;
    setInputInstance((current) => current + 1);
    setSelection({ start: 0, end: rename.initialValue.length });

    const t1 = setTimeout(() => {
      inputRef.current?.focus();
      selectAllText();
    }, 50);
    const t2 = setTimeout(() => {
      selectAllText();
    }, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, rename, selectAllText]);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onDismiss}>
      <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          {renameActive && rename ? (
            <>
              <Text style={styles.renameTitle}>{rename.title}</Text>
              <TextInput
                key={inputInstance}
                ref={inputRef}
                autoFocus
                selectTextOnFocus
                selection={selection}
                style={styles.renameInput}
                value={value}
                onChangeText={setValue}
                onFocus={() => {
                  selectAllText();
                  requestAnimationFrame(selectAllText);
                }}
                onSelectionChange={(event) => {
                  setSelection(event.nativeEvent.selection);
                }}
                onSubmitEditing={() => onRenameSave?.(value)}
              />
              <View style={styles.renameActions}>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={onDismiss}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => onRenameSave?.(value)}>
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => {
                  onSelect(action.id);
                  // Stay open for rename so the same Modal can switch to the form.
                  if (action.id !== 'rename') {
                    onDismiss();
                  }
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
            ))
          )}
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
        renameTitle: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
          paddingTop: 18,
          paddingHorizontal: 18,
        },
        renameInput: {
          marginHorizontal: 18,
          marginTop: 14,
          backgroundColor: colors.pillBackground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 16,
          color: colors.text,
        },
        renameActions: {
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: 24,
          paddingHorizontal: 18,
          paddingVertical: 16,
        },
        cancelText: {
          fontSize: 17,
          color: colors.secondaryText,
        },
        saveText: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [colors]
  );
}
