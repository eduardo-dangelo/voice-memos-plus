import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const DEFAULT_GESTURE_SENSITIVITY = 2;
const DRAG_TRAVEL_PX = 100;
const INPUT_WIDTH = 72;
const TAP_MAX_DISTANCE = 10;

type Props = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  gestureSensitivity?: number;
  decimals?: number;
  step?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  showDragHint?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function formatNumericValue(value: number, decimals: number): string {
  if (decimals <= 0) {
    return String(Math.round(value));
  }
  return value.toFixed(decimals);
}

function parseIntegerDigits(text: string): string {
  return text.replace(/\D/g, '');
}

function sanitizeDecimalInput(text: string, decimals: number): string {
  let cleaned = text.replace(/[^\d.]/g, '');
  const dotIndex = cleaned.indexOf('.');
  if (dotIndex === -1) {
    return cleaned;
  }
  const whole = cleaned.slice(0, dotIndex);
  const fraction = cleaned
    .slice(dotIndex + 1)
    .replace(/\./g, '')
    .slice(0, decimals);
  return `${whole}.${fraction}`;
}

function parseNumericInput(raw: string, decimals: number, fallback: number): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (decimals <= 0) {
    const digits = parseIntegerDigits(trimmed);
    if (digits.length === 0) {
      return null;
    }
    return Number.parseInt(digits, 10);
  }
  if (trimmed === '.') {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function NumericDragInput({
  value,
  min,
  max,
  onChange,
  onCommit,
  gestureSensitivity = DEFAULT_GESTURE_SENSITIVITY,
  decimals = 0,
  step,
  disabled = false,
  accessibilityLabel = 'Numeric value',
  showDragHint = true,
}: Props) {
  const resolvedStep = step ?? (decimals > 0 ? 10 ** -decimals : 1);
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const startValue = useRef(value);
  const lastHapticValue = useRef<number | null>(null);
  const lastCommitted = useRef(value);

  const valueRef = useRef(value);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const gestureSensitivityRef = useRef(gestureSensitivity);
  const decimalsRef = useRef(decimals);
  const stepRef = useRef(resolvedStep);
  const disabledRef = useRef(disabled);
  const focusedRef = useRef(focused);

  valueRef.current = value;
  minRef.current = min;
  maxRef.current = max;
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  gestureSensitivityRef.current = gestureSensitivity;
  decimalsRef.current = decimals;
  stepRef.current = resolvedStep;
  disabledRef.current = disabled;
  focusedRef.current = focused;

  const normalizeValue = useCallback((next: number) => {
    return clamp(roundToStep(next, stepRef.current), minRef.current, maxRef.current);
  }, []);

  useEffect(() => {
    if (!focused) {
      const rounded = normalizeValue(value);
      setDraft(formatNumericValue(rounded, decimalsRef.current));
      lastCommitted.current = rounded;
    }
  }, [focused, normalizeValue, value]);

  const commitValue = useCallback(
    (raw: string, fallback: number) => {
      const parsed = parseNumericInput(raw, decimalsRef.current, fallback);
      if (parsed == null) {
        const reverted = normalizeValue(fallback);
        onChangeRef.current(reverted);
        onCommitRef.current?.(reverted);
        lastCommitted.current = reverted;
        return reverted;
      }
      const next = normalizeValue(parsed);
      onChangeRef.current(next);
      onCommitRef.current?.(next);
      lastCommitted.current = next;
      return next;
    },
    [normalizeValue]
  );

  const applyDragTranslation = useCallback(
    (translationY: number, isComplete: boolean) => {
      if (disabledRef.current || focusedRef.current) {
        return;
      }

      const range = maxRef.current - minRef.current;
      const deltaRatio = (-translationY / DRAG_TRAVEL_PX) * gestureSensitivityRef.current;
      const next = normalizeValue(startValue.current + deltaRatio * range);

      if (next !== lastHapticValue.current) {
        lastHapticValue.current = next;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      onChangeRef.current(next);
      if (isComplete) {
        onCommitRef.current?.(next);
        lastCommitted.current = next;
      }
    },
    [normalizeValue]
  );

  const handlePanStart = useCallback(() => {
    startValue.current = valueRef.current;
    lastHapticValue.current = valueRef.current;
  }, []);

  const handlePanUpdate = useCallback(
    (translationY: number) => {
      applyDragTranslation(translationY, false);
    },
    [applyDragTranslation]
  );

  const handlePanEnd = useCallback(
    (translationY: number) => {
      applyDragTranslation(translationY, true);
    },
    [applyDragTranslation]
  );

  const handleTap = useCallback(() => {
    if (disabledRef.current) {
      return;
    }
    inputRef.current?.focus();
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Pan()
          .activeOffsetY([-6, 6])
          .failOffsetX([-12, 12])
          .onStart(() => {
            runOnJS(handlePanStart)();
          })
          .onUpdate((event) => {
            runOnJS(handlePanUpdate)(event.translationY);
          })
          .onEnd((event) => {
            runOnJS(handlePanEnd)(event.translationY);
          }),
        Gesture.Tap()
          .maxDistance(TAP_MAX_DISTANCE)
          .onEnd(() => {
            runOnJS(handleTap)();
          })
      ),
    [handlePanEnd, handlePanStart, handlePanUpdate, handleTap]
  );

  const displayValue = focused
    ? draft
    : formatNumericValue(normalizeValue(value), decimals);

  const field = (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      style={[styles.container, disabled && styles.disabled]}>
      <TextInput
        ref={inputRef}
        editable={!disabled}
        keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
        pointerEvents={focused ? 'auto' : 'none'}
        returnKeyType="done"
        selectTextOnFocus
        style={[styles.input, showDragHint && styles.inputWithHint]}
        value={displayValue}
        onBlur={() => {
          setFocused(false);
          commitValue(draft, lastCommitted.current);
        }}
        onChangeText={(text) => {
          const sanitized =
            decimals > 0 ? sanitizeDecimalInput(text, decimals) : parseIntegerDigits(text);
          setDraft(sanitized);
          const parsed = parseNumericInput(sanitized, decimals, valueRef.current);
          if (parsed != null) {
            onChangeRef.current(normalizeValue(parsed));
          }
        }}
        onFocus={() => {
          setFocused(true);
          setDraft(formatNumericValue(normalizeValue(value), decimals));
        }}
        onSubmitEditing={() => {
          commitValue(draft, lastCommitted.current);
        }}
      />
      {showDragHint ? (
        <View pointerEvents="none" style={styles.dragHint}>
          <SymbolView
            name={{ ios: 'chevron.up' }}
            size={8}
            tintColor={colors.secondaryText}
          />
          <SymbolView
            name={{ ios: 'chevron.down' }}
            size={8}
            tintColor={colors.secondaryText}
          />
        </View>
      ) : null}
    </View>
  );

  if (disabled || focused) {
    return field;
  }

  return <GestureDetector gesture={gesture}>{field}</GestureDetector>;
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: INPUT_WIDTH,
          height: 36,
          justifyContent: 'center',
          borderRadius: 8,
          backgroundColor: colors.waveformInactive,
          paddingHorizontal: 6,
          position: 'relative',
        },
        input: {
          flex: 1,
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
          paddingVertical: 0,
        },
        inputWithHint: {
          paddingRight: 14,
        },
        dragHint: {
          position: 'absolute',
          right: 4,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
          gap: 0,
        },
        disabled: {
          opacity: 0.4,
        },
      }),
    [colors]
  );
}
