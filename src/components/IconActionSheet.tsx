import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

import { useColorScheme } from '@/components/useColorScheme';
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

export type IconActionSheetFormatPicker = {
  title: string;
};

export type IconActionSheetMultiSelect = {
  title: string;
  options: IconActionSheetItem[];
  confirmTitle?: string;
  /** Minimum selected options required to enable confirm. Defaults to 1. */
  minSelection?: number;
};

const FORMAT_ACTIONS: IconActionSheetItem[] = [
  { id: 'm4a', title: 'm4a', systemImage: 'music.note' },
  { id: 'wav', title: 'wav', systemImage: 'waveform' },
];

type Props = {
  visible: boolean;
  actions: IconActionSheetItem[];
  /** When set, the same Modal shows a select-all rename form instead of actions. */
  rename?: IconActionSheetRename | null;
  /** When set, the same Modal shows format choices instead of actions. */
  formatPicker?: IconActionSheetFormatPicker | null;
  /** When set, the same Modal shows a multi-select checklist. */
  multiSelect?: IconActionSheetMultiSelect | null;
  onSelect: (actionId: string) => void;
  onRenameSave?: (value: string) => void;
  onMultiSelectConfirm?: (selectedIds: string[]) => void;
  onDismiss: () => void;
};

type Selection = NonNullable<TextInputProps['selection']>;

const useGlass = isGlassEffectAPIAvailable();

export function IconActionSheet({
  visible,
  actions,
  rename = null,
  formatPicker = null,
  multiSelect = null,
  onSelect,
  onRenameSave,
  onMultiSelectConfirm,
  onDismiss,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef(rename?.initialValue ?? '');
  const [value, setValue] = useState(rename?.initialValue ?? '');
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [inputInstance, setInputInstance] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const renameActive = rename != null;
  const multiSelectActive = !renameActive && multiSelect != null;
  const formatPickerActive = !renameActive && !multiSelectActive && formatPicker != null;
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
    }, 50);
    const t2 = setTimeout(() => {
      selectAllText();
    }, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, rename, selectAllText]);

  useEffect(() => {
    if (!visible || !multiSelect) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set());
  }, [visible, multiSelect]);

  const listActions = formatPickerActive ? FORMAT_ACTIONS : actions;
  const minSelection = multiSelect?.minSelection ?? 1;
  const canConfirmMulti = selectedIds.size >= minSelection;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  let body: ReactNode;
  if (renameActive && rename) {
    body = (
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
    );
  } else if (multiSelectActive && multiSelect) {
    body = (
      <>
        <Text style={styles.formatTitle}>{multiSelect.title}</Text>
        {multiSelect.options.map((option) => {
          const checked = selectedIds.has(option.id);
          return (
            <Pressable
              key={option.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={styles.row}
              onPress={() => toggleSelected(option.id)}>
              <SymbolView
                name={{
                  ios: (checked ? 'checkmark.circle.fill' : 'circle') as SFSymbol,
                }}
                size={20}
                tintColor={checked ? colors.accent : colors.secondaryText}
              />
              <Text style={styles.rowLabel}>{option.title}</Text>
            </Pressable>
          );
        })}
        <View style={styles.renameActions}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onDismiss}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirmMulti }}
            disabled={!canConfirmMulti}
            hitSlop={8}
            onPress={() => {
              if (!canConfirmMulti) {
                return;
              }
              onMultiSelectConfirm?.([...selectedIds]);
            }}>
            <Text
              style={[styles.saveText, !canConfirmMulti && styles.confirmDisabled]}>
              {multiSelect.confirmTitle ?? 'Merge'}
            </Text>
          </Pressable>
        </View>
      </>
    );
  } else {
    body = (
      <>
        {formatPickerActive && formatPicker ? (
          <Text style={styles.formatTitle}>{formatPicker.title}</Text>
        ) : null}
        {listActions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onSelect(action.id);
              // Stay open for rename/export/merge so the same Modal can switch views.
              if (
                action.id !== 'rename' &&
                action.id !== 'export' &&
                action.id !== 'merge'
              ) {
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
        ))}
      </>
    );
  }

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onDismiss}>
      <Pressable
        accessibilityRole="button"
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onDismiss}>
        <Pressable
          style={styles.cardPressable}
          onPress={(event) => event.stopPropagation()}>
          {useGlass ? (
            <GlassView
              colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
              glassEffectStyle="regular"
              isInteractive
              style={styles.cardGlass}>
              {body}
            </GlassView>
          ) : (
            <View style={styles.cardFallback}>{body}</View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function useStyles(
  colors: ReturnType<typeof useVoiceMemosColors>,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const cardSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

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
        backdropGlass: {
          backgroundColor:
            colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.22)',
        },
        cardPressable: {
          width: '100%',
          maxWidth: 280,
        },
        cardGlass: {
          borderRadius: 20,
          overflow: 'hidden',
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: 20,
          overflow: 'hidden',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.45 : 0.18,
          shadowRadius: 24,
          elevation: 8,
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
        formatTitle: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
          paddingTop: 18,
          paddingBottom: 6,
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
        confirmDisabled: {
          opacity: 0.4,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
