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
  disabled?: boolean;
  accessibilityLabel?: string;
  showDragHint?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToInt(value: number): number {
  return Math.round(value);
}

function parseDigits(text: string): string {
  return text.replace(/\D/g, '');
}

export function NumericDragInput({
  value,
  min,
  max,
  onChange,
  onCommit,
  gestureSensitivity = DEFAULT_GESTURE_SENSITIVITY,
  disabled = false,
  accessibilityLabel = 'Numeric value',
  showDragHint = true,
}: Props) {
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
  const disabledRef = useRef(disabled);
  const focusedRef = useRef(focused);

  valueRef.current = value;
  minRef.current = min;
  maxRef.current = max;
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  gestureSensitivityRef.current = gestureSensitivity;
  disabledRef.current = disabled;
  focusedRef.current = focused;

  useEffect(() => {
    if (!focused) {
      const rounded = roundToInt(value);
      setDraft(String(rounded));
      lastCommitted.current = rounded;
    }
  }, [focused, value]);

  const commitValue = useCallback((raw: string, fallback: number) => {
    const digits = parseDigits(raw);
    if (digits.length === 0) {
      const reverted = clamp(roundToInt(fallback), minRef.current, maxRef.current);
      onChangeRef.current(reverted);
      onCommitRef.current?.(reverted);
      lastCommitted.current = reverted;
      return reverted;
    }
    const parsed = clamp(roundToInt(Number.parseInt(digits, 10)), minRef.current, maxRef.current);
    onChangeRef.current(parsed);
    onCommitRef.current?.(parsed);
    lastCommitted.current = parsed;
    return parsed;
  }, []);

  const applyDragTranslation = useCallback((translationY: number, isComplete: boolean) => {
    if (disabledRef.current || focusedRef.current) {
      return;
    }

    const range = maxRef.current - minRef.current;
    const deltaRatio = (-translationY / DRAG_TRAVEL_PX) * gestureSensitivityRef.current;
    const next = clamp(
      roundToInt(startValue.current + deltaRatio * range),
      minRef.current,
      maxRef.current
    );

    if (next !== lastHapticValue.current) {
      lastHapticValue.current = next;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    onChangeRef.current(next);
    if (isComplete) {
      onCommitRef.current?.(next);
      lastCommitted.current = next;
    }
  }, []);

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

  const displayValue = focused ? draft : String(roundToInt(value));

  const field = (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      style={[styles.container, disabled && styles.disabled]}>
      <TextInput
        ref={inputRef}
        editable={!disabled}
        keyboardType="number-pad"
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
          const digits = parseDigits(text);
          setDraft(digits);
          if (digits.length > 0) {
            const parsed = Number.parseInt(digits, 10);
            if (Number.isFinite(parsed)) {
              onChangeRef.current(clamp(parsed, minRef.current, maxRef.current));
            }
          }
        }}
        onFocus={() => {
          setFocused(true);
          setDraft(String(roundToInt(value)));
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
