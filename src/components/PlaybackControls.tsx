import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatDuration } from '@/src/utils/format';

type Props = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onRecordPress?: () => void;
  onStopRecording?: () => void;
  recordDisabled?: boolean;
  stopRecordingDisabled?: boolean;
  isStoppingRecording?: boolean;
  isRecording?: boolean;
  compact?: boolean;
  showProgressBar?: boolean;
  showTimeLabels?: boolean;
};

export function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onSkipBack,
  onSkipForward,
  onRecordPress,
  onStopRecording,
  recordDisabled = false,
  stopRecordingDisabled = false,
  isStoppingRecording = false,
  isRecording = false,
  compact = false,
  showProgressBar = true,
  showTimeLabels = true,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const progress = duration > 0 ? currentTime / duration : 0;
  const stopDisabled = stopRecordingDisabled || isStoppingRecording;

  return (
    <View style={styles.container}>
      {showProgressBar ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      ) : null}
      <View
        style={[
          styles.controlsRow,
          styles.controlsRowMinHeight,
          !showTimeLabels && styles.controlsRowCentered,
        ]}>
        {showTimeLabels ? <Text style={styles.time}>{formatDuration(currentTime)}</Text> : null}
        {isRecording ? (
          <Pressable
            accessibilityLabel="Stop recording"
            disabled={stopDisabled}
            hitSlop={12}
            onPress={onStopRecording}
            style={[
              styles.stopButton,
              compact && styles.stopButtonCompact,
              stopRecordingDisabled && !isStoppingRecording && styles.recordDisabled,
            ]}>
            <View style={[styles.stopSquare, compact && styles.stopSquareCompact]} />
          </Pressable>
        ) : (
          <View style={styles.buttons}>
            <Pressable accessibilityLabel="Skip back 15 seconds" onPress={onSkipBack} style={styles.iconButton}>
              <SymbolView name={{ ios: 'gobackward.15' }} size={compact ? 24 : 28} tintColor={colors.text} />
            </Pressable>
            <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} onPress={onPlayPause} style={styles.playButton}>
              <SymbolView
                name={{ ios: isPlaying ? 'pause.fill' : 'play.fill' }}
                size={compact ? 28 : 34}
                tintColor={colors.text}
              />
            </Pressable>
            {onRecordPress ? (
              <Pressable
                accessibilityLabel="Record"
                disabled={recordDisabled}
                onPress={onRecordPress}
                style={[
                  styles.recordButton,
                  compact && styles.recordButtonCompact,
                  recordDisabled && styles.recordDisabled,
                ]}>
                <View style={[styles.recordDot, compact && styles.recordDotCompact]} />
              </Pressable>
            ) : null}
            <Pressable accessibilityLabel="Skip forward 15 seconds" onPress={onSkipForward} style={styles.iconButton}>
              <SymbolView name={{ ios: 'goforward.15' }} size={compact ? 24 : 28} tintColor={colors.text} />
            </Pressable>
          </View>
        )}
        {showTimeLabels ? <Text style={styles.time}>{formatDuration(duration)}</Text> : null}
      </View>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: 8,
        },
        progressTrack: {
          height: 3,
          backgroundColor: colors.waveformInactive,
          borderRadius: 2,
          overflow: 'hidden',
        },
        progressFill: {
          height: '100%',
          backgroundColor: colors.accent,
        },
        controlsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        controlsRowMinHeight: {
          minHeight: 48,
        },
        controlsRowCentered: {
          justifyContent: 'center',
        },
        buttons: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 20,
        },
        iconButton: {
          padding: 4,
        },
        playButton: {
          padding: 4,
        },
        recordButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.recordRed,
          alignItems: 'center',
          justifyContent: 'center',
        },
        recordButtonCompact: {
          width: 28,
          height: 28,
          borderRadius: 14,
        },
        stopButton: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.recordRed,
          alignItems: 'center',
          justifyContent: 'center',
        },
        stopButtonCompact: {
          width: 40,
          height: 40,
          borderRadius: 20,
        },
        recordDisabled: {
          opacity: 0.4,
        },
        recordDot: {
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: '#FFFFFF',
        },
        recordDotCompact: {
          width: 10,
          height: 10,
          borderRadius: 5,
        },
        stopSquare: {
          width: 16,
          height: 16,
          borderRadius: 2,
          backgroundColor: '#FFFFFF',
        },
        stopSquareCompact: {
          width: 14,
          height: 14,
          borderRadius: 2,
        },
        time: {
          width: 52,
          fontSize: 12,
          color: colors.secondaryText,
          fontVariant: ['tabular-nums'],
        },
      }),
    [colors]
  );
}
