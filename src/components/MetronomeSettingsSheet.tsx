import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useAudioEngine, useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import {
  GRID_BASIS_PRESETS,
  METRONOME_GRID_SUBDIVISIONS,
  TIME_GRID_SUBDIVISIONS,
  type GridBasis,
  type MetronomeGridSubdivision,
  type MetronomeSettings,
  type TimeGridSubdivision,
  type TimeSignaturePreset,
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EditorSlider } from './track-editor/primitives/EditorSlider';
import { NumericDragInput } from './track-editor/primitives/NumericDragInput';
import { PresetPills } from './track-editor/primitives/PresetPills';

type Props = {
  visible: boolean;
  settings: MetronomeSettings;
  onChange: (partial: Partial<MetronomeSettings>) => void;
  onClose: () => void;
};

const TIME_SIGNATURE_OPTIONS: { id: TimeSignaturePreset; label: string }[] = [
  { id: '4/4', label: '4/4' },
  { id: '3/4', label: '3/4' },
  { id: '2/4', label: '2/4' },
  { id: '6/8', label: '6/8' },
  { id: '5/4', label: '5/4' },
];

const ACCENT_OPTIONS: { id: 'on' | 'off'; label: string }[] = [
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

const GRID_BASIS_OPTIONS: { id: GridBasis; label: string }[] = GRID_BASIS_PRESETS.map((id) => ({
  id,
  label: id === 'metronome' ? 'Metronome' : 'Time',
}));

const METRONOME_SUBDIVISION_OPTIONS: { id: MetronomeGridSubdivision; label: string }[] =
  METRONOME_GRID_SUBDIVISIONS.map((id) => ({ id, label: id }));

const TIME_SUBDIVISION_OPTIONS: { id: TimeGridSubdivision; label: string }[] =
  TIME_GRID_SUBDIVISIONS.map((id) => ({ id, label: id }));

const useGlass = isGlassEffectAPIAvailable();

export function MetronomeSettingsSheet({ visible, settings, onChange, onClose }: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const engine = useAudioEngine();
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  const isPlaying = useAudioEngineSelector((state) => state.isPlaying);
  const [previewActive, setPreviewActive] = useState(false);
  const previewActiveRef = useRef(false);
  previewActiveRef.current = previewActive;

  useEffect(() => {
    if (!visible) {
      engine.stopMetronomePreview();
      setPreviewActive(false);
    }
  }, [visible, engine]);

  useEffect(() => {
    if (isRecording && previewActive) {
      engine.stopMetronomePreview();
      setPreviewActive(false);
    }
  }, [isRecording, previewActive, engine]);

  useEffect(() => {
    if (!previewActiveRef.current) {
      return;
    }
    void engine.startMetronomePreview(settings);
  }, [
    engine,
    settings.accentEnabled,
    settings.bpm,
    settings.timeSignature,
    settings.volume,
  ]);

  const previewDisabled = isRecording || isPlaying;

  const togglePreview = () => {
    if (previewDisabled) {
      return;
    }
    if (previewActive) {
      engine.stopMetronomePreview();
      setPreviewActive(false);
      return;
    }
    void engine.startMetronomePreview(settings).then(() => {
      setPreviewActive(true);
    });
  };

  const body = (
    <>
      <Text style={[styles.title, styles.sectionTitle]}>Metronome</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Tempo</Text>
        <View style={styles.tempoControls}>
          <NumericDragInput
            accessibilityLabel="Tempo, beats per minute"
            max={240}
            min={40}
            value={settings.bpm}
            onChange={(bpm) => onChange({ bpm })}
          />
          <Text style={styles.bpmSuffix}>BPM</Text>
          <Pressable
            accessibilityLabel={previewActive ? 'Stop metronome preview' : 'Play metronome preview'}
            accessibilityRole="button"
            accessibilityState={{ disabled: previewDisabled }}
            disabled={previewDisabled}
            hitSlop={8}
            style={[styles.previewButton, previewDisabled && styles.previewButtonDisabled]}
            onPress={togglePreview}>
            <SymbolView
              name={{ ios: previewActive ? 'stop.fill' : 'play.fill' }}
              size={16}
              tintColor={previewDisabled ? colors.secondaryText : colors.accent}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Time signature</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            options={TIME_SIGNATURE_OPTIONS}
            selectedId={settings.timeSignature}
            onSelect={(timeSignature) => onChange({ timeSignature })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Accent</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            options={ACCENT_OPTIONS}
            selectedId={settings.accentEnabled ? 'on' : 'off'}
            onSelect={(value) => onChange({ accentEnabled: value === 'on' })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Volume</Text>
        <View style={styles.volumeControls}>
          <View style={styles.sliderTrack}>
            <EditorSlider
              maximumValue={100}
              minimumValue={0}
              value={settings.volume}
              onSlidingComplete={(volume) => onChange({ volume })}
              onValueChange={(volume) => onChange({ volume })}
            />
          </View>
          <Text style={styles.sliderValue}>{Math.round(settings.volume)}%</Text>
        </View>
      </View>

      <Text style={[styles.title, styles.sectionTitle]}>Grid</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Show grid lines</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            options={ACCENT_OPTIONS}
            selectedId={settings.showGrid ? 'on' : 'off'}
            onSelect={(value) => onChange({ showGrid: value === 'on' })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Based on</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            options={GRID_BASIS_OPTIONS}
            selectedId={settings.gridBasis}
            onSelect={(gridBasis) => onChange({ gridBasis })}
          />
        </View>
      </View>

      <View style={[styles.pillRow, styles.pillRowLast]}>
        <Text style={styles.pillRowLabel}>Subdivision</Text>
        <View style={styles.pillRowPills}>
          {settings.gridBasis === 'time' ? (
            <PresetPills
              align="end"
              compact
              options={TIME_SUBDIVISION_OPTIONS}
              selectedId={settings.timeGridSubdivision}
              onSelect={(timeGridSubdivision) => onChange({ timeGridSubdivision })}
            />
          ) : (
            <PresetPills
              align="end"
              compact
              options={METRONOME_SUBDIVISION_OPTIONS}
              selectedId={settings.metronomeGridSubdivision}
              onSelect={(metronomeGridSubdivision) => onChange({ metronomeGridSubdivision })}
            />
          )}
        </View>
      </View>
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
        <Pressable style={styles.cardPressable} onPress={() => {}}>
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
          maxWidth: 340,
        },
        cardGlass: {
          borderRadius: 20,
          paddingHorizontal: 20,
          paddingVertical: 18,
          gap: 14,
        },
        cardFallback: {
          backgroundColor: cardSurface,
          borderRadius: 20,
          paddingHorizontal: 20,
          paddingVertical: 18,
          gap: 14,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.45 : 0.18,
          shadowRadius: 24,
          elevation: 8,
        },
        title: {
          fontSize: 17,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
        },
        sectionTitle: {
          marginBottom: 10,
        },
        tempoControls: {
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        },
        volumeControls: {
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        },
        sliderTrack: {
          width: 148,
          flexShrink: 1,
        },
        sliderValue: {
          width: 36,
          fontSize: 12,
          color: colors.secondaryText,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
        },
        bpmSuffix: {
          width: 32,
          fontSize: 12,
          color: colors.secondaryText,
          fontVariant: ['tabular-nums'],
        },
        previewButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.waveformInactive,
        },
        previewButtonDisabled: {
          opacity: 0.4,
        },
        pillRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        pillRowLabel: {
          width: 78,
          fontSize: 13,
          color: colors.secondaryText,
        },
        pillRowPills: {
          flex: 1,
          minWidth: 0,
        },
        pillRowLast: {
          marginBottom: 8,
        },
      }),
    [cardSurface, colorScheme, colors]
  );
}
