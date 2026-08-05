import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const useGlass = isGlassEffectAPIAvailable();

export type HeadphonesRecommendedDialogProps = {
  visible: boolean;
  onCancel: () => void;
  onContinue: () => void;
};

export function HeadphonesRecommendedDialog({
  visible,
  onCancel,
  onContinue,
}: HeadphonesRecommendedDialogProps) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onCancel}>
      <Pressable
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onCancel}>
        <DialogCard styles={styles} colorScheme={colorScheme}>
          <View style={styles.titleRow}>
            <SymbolView
              name={{ ios: 'exclamationmark.triangle.fill' }}
              size={18}
              tintColor="#FF9F0A"
            />
            <Text style={styles.title}>Headphones recommended</Text>
          </View>
          <View style={styles.iconWrap}>
            <SymbolView
              name={{ ios: 'headphones' }}
              size={56}
              tintColor={colors.text}
            />
          </View>
          <Text style={styles.message}>
            Without headphones, playback will leak into the new track through the
            microphone. Are you sure you want to continue?
          </Text>
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
              onPress={onContinue}>
              <Text style={styles.continueText}>Continue</Text>
            </Pressable>
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
  colorScheme: 'light' | 'dark' | null | undefined
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
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        iconWrap: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 4,
        },
        message: {
          alignSelf: 'stretch',
          fontSize: 15,
          lineHeight: 21,
          color: colors.secondaryText,
          textAlign: 'left',
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
        continueText: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.accent,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
