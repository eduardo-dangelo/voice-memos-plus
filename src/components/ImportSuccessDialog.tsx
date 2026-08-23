import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export type ShowImportSuccessOptions = {
  title: string;
  onDone?: () => void;
};

type ShowHandler = (options: ShowImportSuccessOptions) => void;

let showHandler: ShowHandler | null = null;

/** Imperative entry point for non-React call sites (e.g. import actions). */
export function showImportSuccess(options: ShowImportSuccessOptions): void {
  if (showHandler == null) {
    options.onDone?.();
    return;
  }
  showHandler(options);
}

type DialogProps = {
  visible: boolean;
  memoTitle: string;
  onDone: () => void;
};

function ImportSuccessDialog({ visible, memoTitle, onDone }: DialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onDone}>
      <Pressable
        accessibilityRole="button"
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onDone}>
        <Pressable
          style={styles.cardPressable}
          onPress={(event) => event.stopPropagation()}>
          <DialogCard styles={styles} colorScheme={colorScheme}>
            <SymbolView
              name={{ ios: 'checkmark.circle.fill' as SFSymbol }}
              size={44}
              tintColor={colors.accent}
            />
            <Text style={styles.title}>Import complete</Text>
            <Text style={styles.body}>
              “{memoTitle}” was added to your library.
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              style={styles.doneButton}
              onPress={onDone}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </DialogCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Mount once near the app root so `showImportSuccess` can present the dialog. */
export function ImportSuccessHost() {
  const [visible, setVisible] = useState(false);
  const [memoTitle, setMemoTitle] = useState('');
  const onDoneRef = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    showHandler = (options) => {
      setMemoTitle(options.title);
      onDoneRef.current = options.onDone;
      setVisible(true);
    };
    return () => {
      showHandler = null;
    };
  }, []);

  const handleDone = () => {
    setVisible(false);
    const onDone = onDoneRef.current;
    onDoneRef.current = undefined;
    onDone?.();
  };

  return (
    <ImportSuccessDialog
      visible={visible}
      memoTitle={memoTitle}
      onDone={handleDone}
    />
  );
}

const useGlass = isGlassEffectAPIAvailable();

function DialogCard({
  styles,
  colorScheme,
  children,
}: {
  styles: ReturnType<typeof useStyles>;
  colorScheme: 'light' | 'dark' | null | undefined;
  children: ReactNode;
}) {
  if (useGlass) {
    return (
      <GlassView
        colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
        glassEffectStyle="regular"
        isInteractive
        style={styles.cardGlass}>
        {children}
      </GlassView>
    );
  }
  return <View style={styles.cardFallback}>{children}</View>;
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
          maxWidth: 300,
        },
        cardGlass: {
          borderRadius: 20,
          paddingHorizontal: 22,
          paddingTop: 24,
          paddingBottom: 14,
          alignItems: 'center',
          gap: 12,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: 20,
          paddingHorizontal: 22,
          paddingTop: 24,
          paddingBottom: 14,
          alignItems: 'center',
          gap: 12,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        body: {
          fontSize: 15,
          lineHeight: 20,
          color: colors.secondaryText,
          textAlign: 'center',
        },
        doneButton: {
          alignSelf: 'stretch',
          alignItems: 'center',
          paddingVertical: 10,
          marginTop: 4,
        },
        doneText: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
