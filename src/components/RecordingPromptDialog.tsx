import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const useGlass = isGlassEffectAPIAvailable();

export type RecordingPromptTitleIcon = 'warning' | 'info' | 'none';

export type RecordingPromptDialogProps = {
  visible: boolean;
  title: string;
  heroIcon: string;
  message: string;
  compact?: boolean;
  titleIcon?: RecordingPromptTitleIcon;
  actions?: 'ok' | 'confirm' | 'continue';
  onDismiss: () => void;
  onContinue?: () => void;
  /** Backdrop tap; defaults to `onDismiss` when omitted. */
  onBackdropDismiss?: () => void;
};

export function RecordingPromptDialog({
  visible,
  title,
  heroIcon,
  message,
  compact = false,
  titleIcon = 'warning',
  actions = 'confirm',
  onDismiss,
  onContinue,
  onBackdropDismiss,
}: RecordingPromptDialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme, compact);
  const titleIconName =
    titleIcon === 'info'
      ? 'info.circle.fill'
      : titleIcon === 'warning'
        ? 'exclamationmark.triangle.fill'
        : null;
  const titleIconColor =
    titleIcon === 'info' ? colors.accent : '#FF9F0A';

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onDismiss}>
      <Pressable
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onBackdropDismiss ?? onDismiss}>
        <DialogCard styles={styles} colorScheme={colorScheme}>
          <View style={styles.titleRow}>
            {titleIconName ? (
              <SymbolView
                name={{ ios: titleIconName }}
                size={compact ? 16 : 18}
                tintColor={titleIconColor}
              />
            ) : null}
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={styles.iconWrap}>
            <SymbolView
              name={{ ios: heroIcon }}
              size={compact ? 44 : 56}
              tintColor={colors.text}
            />
          </View>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            {actions === 'confirm' ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.actionButton}
                  onPress={onDismiss}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.actionButton}
                  onPress={onContinue}>
                  <Text style={styles.continueText}>Continue</Text>
                </Pressable>
              </>
            ) : actions === 'continue' ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                style={styles.actionButton}
                onPress={onContinue}>
                <Text style={styles.continueText}>Continue</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                style={styles.actionButton}
                onPress={onDismiss}>
                <Text style={styles.continueText}>OK</Text>
              </Pressable>
            )}
          </View>
        </DialogCard>
      </Pressable>
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
  colorScheme: 'light' | 'dark' | null | undefined,
  compact: boolean
) {
  const cardSurface =
    colorScheme === 'dark' ? colors.sheetBackground : colors.background;

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
        backdropGlass: {
          backgroundColor:
            colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.22)',
        },
        cardPressable: {
          width: '100%',
          maxWidth: compact ? 280 : 320,
        },
        cardGlass: {
          borderRadius: compact ? 16 : 20,
          paddingHorizontal: compact ? 18 : 22,
          paddingTop: compact ? 18 : 22,
          paddingBottom: compact ? 12 : 14,
          alignItems: 'stretch',
          gap: compact ? 10 : 14,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: compact ? 16 : 20,
          paddingHorizontal: compact ? 18 : 22,
          paddingTop: compact ? 18 : 22,
          paddingBottom: compact ? 12 : 14,
          alignItems: 'stretch',
          gap: compact ? 10 : 14,
        },
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        title: {
          fontSize: compact ? 16 : 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        iconWrap: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: compact ? 2 : 4,
        },
        message: {
          alignSelf: 'stretch',
          fontSize: compact ? 14 : 15,
          lineHeight: compact ? 19 : 21,
          color: colors.secondaryText,
          textAlign: 'left',
        },
        actions: {
          flexDirection: 'row',
          alignSelf: 'stretch',
          justifyContent: 'flex-end',
          gap: 24,
          paddingTop: compact ? 4 : 6,
        },
        actionButton: {
          paddingVertical: 6,
        },
        cancelText: {
          fontSize: compact ? 16 : 17,
          color: colors.secondaryText,
        },
        continueText: {
          fontSize: compact ? 16 : 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors, compact]
  );
}
