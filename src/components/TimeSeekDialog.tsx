import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import {
  digitsFromTimecode,
  formatTimecodeDigits,
  MAX_TIMECODE_DIGITS,
  MIN_TIMECODE_DIGITS,
  parseDuration,
} from '@/src/utils/format';

const useGlass = isGlassEffectAPIAvailable();

export type TimeSeekDialogProps = {
  visible: boolean;
  initialValue: string;
  /** Use 8-digit `hh:mm:ss.cc` when the memo can exceed one hour. */
  includeHours?: boolean;
  onCancel: () => void;
  onSeek: (seconds: number) => void;
};

export function TimeSeekDialog({
  visible,
  initialValue,
  includeHours = false,
  onCancel,
  onSeek,
}: TimeSeekDialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const maxDigits = includeHours ? MAX_TIMECODE_DIGITS : MIN_TIMECODE_DIGITS;
  const inputRef = useRef<TextInput>(null);
  const digitsRef = useRef('');
  const startedTypingRef = useRef(false);
  const [digits, setDigits] = useState('');
  const [inputInstance, setInputInstance] = useState(0);
  digitsRef.current = digits;

  const display = formatTimecodeDigits(digits, maxDigits);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const next = digitsFromTimecode(initialValue, maxDigits).padStart(maxDigits, '0');
    startedTypingRef.current = false;
    digitsRef.current = next;
    setDigits(next);
    setInputInstance((current) => current + 1);
    const t1 = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(t1);
    };
  }, [visible, initialValue, maxDigits]);

  const applyDigit = (digit: string) => {
    setDigits((current) => {
      if (!startedTypingRef.current) {
        startedTypingRef.current = true;
        return digit;
      }
      return (current + digit).slice(-maxDigits);
    });
  };

  const applyBackspace = () => {
    startedTypingRef.current = true;
    setDigits((current) => current.slice(0, -1));
  };

  const handleSeek = () => {
    const parsed = parseDuration(formatTimecodeDigits(digitsRef.current, maxDigits));
    if (parsed == null) {
      onCancel();
      return;
    }
    onSeek(parsed);
  };

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}>
        <Pressable
          style={[styles.backdrop, useGlass && styles.backdropGlass]}
          onPress={onCancel}>
          <DialogCard styles={styles} colorScheme={colorScheme}>
            <Text style={styles.title}>Go to Time</Text>
            <Pressable style={styles.timeField} onPress={() => inputRef.current?.focus()}>
              <Text pointerEvents="none" style={styles.timeDisplay}>
                {display}
              </Text>
              <TextInput
                key={inputInstance}
                ref={inputRef}
                autoFocus
                caretHidden
                contextMenuHidden
                importantForAutofill="no"
                keyboardType="number-pad"
                showSoftInputOnFocus
                style={styles.hiddenInput}
                value={digits}
                onChangeText={(text) => {
                  if (Platform.OS === 'ios') {
                    return;
                  }
                  const incoming = digitsFromTimecode(text, maxDigits + 1);
                  const prev = digitsRef.current;
                  if (incoming.length > prev.length) {
                    applyDigit(incoming.slice(-1));
                    return;
                  }
                  if (incoming.length < prev.length) {
                    applyBackspace();
                  }
                }}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace') {
                    applyBackspace();
                    return;
                  }
                  if (/^\d$/.test(nativeEvent.key)) {
                    applyDigit(nativeEvent.key);
                  }
                }}
                onSubmitEditing={handleSeek}
              />
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                style={styles.actionButton}
                onPress={onCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                style={styles.actionButton}
                onPress={handleSeek}>
                <Text style={styles.goText}>Go</Text>
              </Pressable>
            </View>
          </DialogCard>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DialogCard({
  styles,
  colorScheme,
  children,
}: {
  styles: ReturnType<typeof useStyles>;
  colorScheme: 'light' | 'dark' | null | undefined;
  children: ReactNode;
}) {
  return (
    <Pressable style={styles.cardPressable} onPress={() => {}}>
      {useGlass ? (
        <GlassView
          colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
          glassEffectStyle="regular"
          isInteractive
          style={styles.cardGlass}>
          {children}
        </GlassView>
      ) : (
        <View style={styles.cardFallback}>{children}</View>
      )}
    </Pressable>
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
        backdropGlass: {
          backgroundColor:
            colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.22)',
        },
        cardPressable: {
          width: '100%',
          maxWidth: 300,
        },
        cardGlass: {
          borderRadius: 20,
          paddingHorizontal: 22,
          paddingTop: 22,
          paddingBottom: 14,
          alignItems: 'stretch',
          gap: 14,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: 20,
          paddingHorizontal: 22,
          paddingTop: 22,
          paddingBottom: 14,
          alignItems: 'stretch',
          gap: 14,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        timeField: {
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 52,
        },
        timeDisplay: {
          fontSize: 36,
          fontWeight: '300',
          color: colors.text,
          fontVariant: ['tabular-nums'],
          textAlign: 'center',
        },
        hiddenInput: {
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
        },
        actions: {
          flexDirection: 'row',
          alignSelf: 'stretch',
          justifyContent: 'flex-end',
          gap: 24,
          paddingTop: 6,
        },
        actionButton: {
          paddingVertical: 6,
        },
        cancelText: {
          fontSize: 17,
          color: colors.secondaryText,
        },
        goText: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
