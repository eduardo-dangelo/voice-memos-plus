import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import {
  clampEqBandFrequency,
  clampEqQ,
  syncDelayTimeMs,
  type EqBandFrequencies,
  type EqBandGains,
  type EqBandQFactors,
  type LayerEffects,
  type LayerEffectsChange,
} from '@/src/audio/layerEffects';
import { useIsRegularWidth } from '@/src/hooks/useIsRegularWidth';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EditorSlider } from './primitives/EditorSlider';
import { EqCurveChart, type EqBandChange } from './primitives/EqCurveChart';

export type EffectCustomKind = 'reverb' | 'delay' | 'eq';

type Props = {
  visible: boolean;
  effect: EffectCustomKind;
  effects: LayerEffects;
  onChange: (partial: LayerEffectsChange) => void;
  onClose: () => void;
};

const TITLES: Record<EffectCustomKind, string> = {
  reverb: 'Reverb',
  delay: 'Delay',
  eq: 'EQ',
};

const useGlass = isGlassEffectAPIAvailable();

export function EffectCustomDialog({ visible, effect, effects, onChange, onClose }: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const isRegularWidth = useIsRegularWidth();
  const styles = useStyles(colors, colorScheme, isRegularWidth);

  const updateBand = (index: number, change: EqBandChange) => {
    const nextBands = [...effects.eq.bands] as EqBandGains;
    const nextFrequencies = [...effects.eq.frequencies] as EqBandFrequencies;
    const nextQFactors = [...effects.eq.qFactors] as EqBandQFactors;
    if (change.gain != null) {
      nextBands[index] = change.gain;
    }
    if (change.frequency != null) {
      nextFrequencies[index] = clampEqBandFrequency(
        index,
        change.frequency,
        nextFrequencies
      );
    }
    if (change.q != null) {
      nextQFactors[index] = clampEqQ(change.q);
    }
    onChange({
      eq: {
        bands: nextBands,
        frequencies: nextFrequencies,
        qFactors: nextQFactors,
      },
    });
  };

  const displayTimeMs =
    effects.delay.sync === 'off' ? effects.delay.timeMs : syncDelayTimeMs(effects.delay.sync);

  const body = (
    <>
      <Text style={styles.title}>{TITLES[effect]}</Text>

      {effect === 'reverb' ? (
        <View style={styles.section}>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Mix</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={100}
                minimumValue={0}
                value={effects.reverb.mix}
                onSlidingComplete={(mix) => onChange({ reverb: { mix } })}
                onValueChange={(mix) => onChange({ reverb: { mix } })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(effects.reverb.mix)}%</Text>
          </View>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Decay</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={3}
                minimumValue={0.1}
                value={effects.reverb.decay}
                onSlidingComplete={(decay) => onChange({ reverb: { decay } })}
                onValueChange={(decay) => onChange({ reverb: { decay } })}
              />
            </View>
            <Text style={styles.sliderValue}>{effects.reverb.decay.toFixed(1)}s</Text>
          </View>
        </View>
      ) : null}

      {effect === 'delay' ? (
        <View style={styles.section}>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Time</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={2000}
                minimumValue={50}
                value={displayTimeMs}
                onSlidingComplete={(timeMs) =>
                  onChange({ delay: { timeMs, sync: 'off' } })
                }
                onValueChange={(timeMs) =>
                  onChange({ delay: { timeMs, sync: 'off' } })
                }
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(displayTimeMs)} ms</Text>
          </View>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Mix</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={100}
                minimumValue={0}
                value={effects.delay.mix}
                onSlidingComplete={(mix) => onChange({ delay: { mix } })}
                onValueChange={(mix) => onChange({ delay: { mix } })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(effects.delay.mix)}%</Text>
          </View>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Feedback</Text>
            <View style={styles.sliderTrack}>
              <EditorSlider
                maximumValue={85}
                minimumValue={0}
                value={effects.delay.feedback}
                onSlidingComplete={(feedback) => onChange({ delay: { feedback } })}
                onValueChange={(feedback) => onChange({ delay: { feedback } })}
              />
            </View>
            <Text style={styles.sliderValue}>{Math.round(effects.delay.feedback)}%</Text>
          </View>
        </View>
      ) : null}

      {effect === 'eq' ? (
        <View style={styles.section}>
          <EqCurveChart
            key={visible ? 'eq-open' : 'eq-closed'}
            bands={effects.eq.bands}
            frequencies={effects.eq.frequencies}
            large={isRegularWidth}
            qFactors={effects.eq.qFactors}
            onChange={updateBand}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <Modal
      animationType={useGlass ? 'none' : 'fade'}
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, useGlass && styles.backdropGlass]}
        onPress={onClose}>
        <DialogCard useGlass={useGlass} styles={styles} colorScheme={colorScheme}>
          {body}
        </DialogCard>
      </Pressable>
    </Modal>
  );
}

function DialogCard({
  useGlass: glass,
  styles,
  colorScheme,
  children,
}: {
  useGlass: boolean;
  styles: ReturnType<typeof useStyles>;
  colorScheme: 'light' | 'dark' | null | undefined;
  children: ReactNode;
}) {
  return (
    <Pressable style={styles.cardPressable} onPress={() => {}}>
      {glass ? (
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
  large: boolean
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
          padding: large ? 32 : 24,
        },
        backdropGlass: {
          backgroundColor:
            colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.22)',
        },
        cardPressable: {
          width: '100%',
          maxWidth: large ? 640 : 340,
        },
        cardGlass: {
          borderRadius: large ? 24 : 20,
          paddingHorizontal: large ? 28 : 20,
          paddingVertical: large ? 24 : 18,
          gap: large ? 18 : 14,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: large ? 24 : 20,
          paddingHorizontal: large ? 28 : 20,
          paddingVertical: large ? 24 : 18,
          gap: large ? 18 : 14,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.45 : 0.18,
          shadowRadius: 24,
          elevation: 8,
        },
        title: {
          fontSize: large ? 22 : 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        section: {
          gap: large ? 14 : 10,
        },
        sliderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: large ? 12 : 8,
        },
        sliderLabel: {
          width: large ? 88 : 72,
          fontSize: large ? 15 : 13,
          color: colors.secondaryText,
        },
        sliderTrack: {
          flex: 1,
        },
        sliderValue: {
          width: large ? 64 : 52,
          fontSize: large ? 14 : 12,
          color: colors.secondaryText,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
        },
      }),
    [cardSurface, colorScheme, colors, large]
  );
}
