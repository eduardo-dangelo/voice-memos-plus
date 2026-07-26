import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type NamePromptDialogProps = {
  visible: boolean;
  title: string;
  initialValue: string;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type Selection = NonNullable<TextInputProps['selection']>;

export function NamePromptDialog({
  visible,
  title,
  initialValue,
  saveLabel = 'Save',
  onCancel,
  onSave,
}: NamePromptDialogProps) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef(initialValue);
  const [value, setValue] = useState(initialValue);
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  /** Remount input each open so focus/selection start clean. */
  const [inputInstance, setInputInstance] = useState(0);
  valueRef.current = value;

  const selectAllText = useCallback(() => {
    const length = valueRef.current.length;
    const selectAll: Selection = { start: 0, end: length };
    setSelection(selectAll);
    inputRef.current?.setSelection(0, length);
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelection(undefined);
      return;
    }
    setValue(initialValue);
    valueRef.current = initialValue;
    setInputInstance((current) => current + 1);
    setSelection({ start: 0, end: initialValue.length });

    // Modal + keyboard focus often lands after the first paint; re-apply select-all.
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
  }, [visible, initialValue, selectAllText]);

  const handleSave = () => {
    onSave(value);
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>{title}</Text>
            <TextInput
              key={inputInstance}
              ref={inputRef}
              autoFocus
              selectTextOnFocus
              selection={selection}
              style={styles.input}
              value={value}
              onChangeText={setValue}
              onFocus={() => {
                selectAllText();
                requestAnimationFrame(selectAllText);
              }}
              onSelectionChange={(event) => {
                setSelection(event.nativeEvent.selection);
              }}
              onSubmitEditing={handleSave}
            />
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={onCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={handleSave}>
                <Text style={styles.saveText}>{saveLabel}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        keyboard: {
          flex: 1,
        },
        backdrop: {
          flex: 1,
          backgroundColor: colors.overlayBackground,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        },
        card: {
          width: '100%',
          maxWidth: 340,
          backgroundColor: colors.sheetBackground,
          borderRadius: 14,
          paddingHorizontal: 20,
          paddingVertical: 18,
          gap: 14,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        input: {
          // pillBackground contrasts with sheetBackground in dark (searchField does not).
          backgroundColor: colors.pillBackground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 16,
          color: colors.text,
        },
        actions: {
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: 24,
          paddingTop: 2,
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
