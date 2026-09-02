import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
  processing?: boolean;
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

const GRID_PROCESSING_FIELDS: (keyof MetronomeSettings)[] = [
  'showGrid',
  'gridBasis',
  'metronomeGridSubdivision',
  'timeGridSubdivision',
  'bpm',
  'timeSignature',
];

function isGridProcessingChange(partial: Partial<MetronomeSettings>): boolean {
  return GRID_PROCESSING_FIELDS.some((field) => partial[field] !== undefined);
}

const useGlass = isGlassEffectAPIAvailable();

export function MetronomeSettingsSheet({
  visible,
  settings,
  processing = false,
  onChange,
  onClose,
}: Props) {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const styles = useStyles(colors, colorScheme);
  const engine = useAudioEngine();
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  const isPlaying = useAudioEngineSelector((state) => state.isPlaying);
  const [previewActive, setPreviewActive] = useState(false);
  const [optimistic, setOptimistic] = useState(settings);
  const [pendingProcessing, setPendingProcessing] = useState(false);
  const previewActiveRef = useRef(false);
  previewActiveRef.current = previewActive;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (visible) {
      setOptimistic(settingsRef.current);
    } else {
      setPendingProcessing(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!processing) {
      setPendingProcessing(false);
    }
  }, [processing]);

  useEffect(() => {
    if (!pendingProcessing || processing) {
      return;
    }
    const timeout = setTimeout(() => setPendingProcessing(false), 2000);
    return () => clearTimeout(timeout);
  }, [pendingProcessing, processing]);

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
    void engine.startMetronomePreview(optimistic);
  }, [
    engine,
    optimistic.accentEnabled,
    optimistic.bpm,
    optimistic.timeSignature,
    optimistic.volume,
  ]);

  const previewDisabled = isRecording || isPlaying;
  const showSpinner = pendingProcessing || processing;
  const controlsDisabled = showSpinner;

  const handleChange = (partial: Partial<MetronomeSettings>) => {
    if (controlsDisabled && isGridProcessingChange(partial)) {
      return;
    }
    const committedBpm = partial.bpm;
    const isBpmOnlyChange =
      committedBpm !== undefined && Object.keys(partial).length === 1;
    if (isBpmOnlyChange && committedBpm === settingsRef.current.bpm) {
      setOptimistic((current) =>
        current.bpm === committedBpm ? current : { ...current, bpm: committedBpm }
      );
      return;
    }
    setOptimistic((current) => ({ ...current, ...partial }));
    if (isGridProcessingChange(partial)) {
      setPendingProcessing(true);
    }
    startTransition(() => {
      onChange(partial);
    });
  };

  const handleBpmPreview = (bpm: number) => {
    setOptimistic((current) => (current.bpm === bpm ? current : { ...current, bpm }));
  };

  const togglePreview = () => {
    if (previewDisabled) {
      return;
    }
    if (previewActive) {
      engine.stopMetronomePreview();
      setPreviewActive(false);
      return;
    }
    void engine.startMetronomePreview(optimistic).then(() => {
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
            disabled={controlsDisabled}
            max={240}
            min={40}
            value={optimistic.bpm}
            onChange={handleBpmPreview}
            onCommit={(bpm) => handleChange({ bpm })}
          />
          <Text style={styles.bpmSuffix}>BPM</Text>
          <Pressable
            accessibilityLabel={previewActive ? 'Stop metronome preview' : 'Play metronome preview'}
            accessibilityRole="button"
            accessibilityState={{ disabled: previewDisabled || controlsDisabled }}
            disabled={previewDisabled || controlsDisabled}
            hitSlop={8}
            style={[
              styles.previewButton,
              (previewDisabled || controlsDisabled) && styles.previewButtonDisabled,
            ]}
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
            disabled={controlsDisabled}
            options={TIME_SIGNATURE_OPTIONS}
            selectedId={optimistic.timeSignature}
            onSelect={(timeSignature) => handleChange({ timeSignature })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Accent</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            disabled={controlsDisabled}
            options={ACCENT_OPTIONS}
            selectedId={optimistic.accentEnabled ? 'on' : 'off'}
            onSelect={(value) => handleChange({ accentEnabled: value === 'on' })}
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
              value={optimistic.volume}
              onSlidingComplete={(volume) => handleChange({ volume })}
              onValueChange={(volume) => handleChange({ volume })}
            />
          </View>
          <Text style={styles.sliderValue}>{Math.round(optimistic.volume)}%</Text>
        </View>
      </View>

      <Text style={[styles.title, styles.sectionTitle]}>Grid</Text>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Show grid lines</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            disabled={controlsDisabled}
            options={ACCENT_OPTIONS}
            selectedId={optimistic.showGrid ? 'on' : 'off'}
            onSelect={(value) => handleChange({ showGrid: value === 'on' })}
          />
        </View>
      </View>

      <View style={styles.pillRow}>
        <Text style={styles.pillRowLabel}>Based on</Text>
        <View style={styles.pillRowPills}>
          <PresetPills
            align="end"
            compact
            disabled={controlsDisabled}
            options={GRID_BASIS_OPTIONS}
            selectedId={optimistic.gridBasis}
            onSelect={(gridBasis) => handleChange({ gridBasis })}
          />
        </View>
      </View>

      <View style={[styles.pillRow, styles.pillRowLast]}>
        <Text style={styles.pillRowLabel}>Subdivision</Text>
        <View style={styles.pillRowPills}>
          {optimistic.gridBasis === 'time' ? (
            <PresetPills
              align="end"
              compact
              disabled={controlsDisabled}
              options={TIME_SUBDIVISION_OPTIONS}
              selectedId={optimistic.timeGridSubdivision}
              onSelect={(timeGridSubdivision) => handleChange({ timeGridSubdivision })}
            />
          ) : (
            <PresetPills
              align="end"
              compact
              disabled={controlsDisabled}
              options={METRONOME_SUBDIVISION_OPTIONS}
              selectedId={optimistic.metronomeGridSubdivision}
              onSelect={(metronomeGridSubdivision) => handleChange({ metronomeGridSubdivision })}
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
          {showSpinner ? (
            <View pointerEvents="auto" style={styles.processingOverlay}>
              <ActivityIndicator color={colors.accent} size="large" />
            </View>
          ) : null}
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
        processingOverlay: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 20,
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
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
