import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { formatDuration } from '@/src/utils/format';

type Props = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
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
  compact = false,
  showProgressBar = true,
  showTimeLabels = true,
}: Props) {
  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <View style={styles.container}>
      {showProgressBar ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      ) : null}
      <View style={[styles.controlsRow, !showTimeLabels && styles.controlsRowCentered]}>
        {showTimeLabels ? <Text style={styles.time}>{formatDuration(currentTime)}</Text> : null}
        <View style={styles.buttons}>
          <Pressable accessibilityLabel="Skip back 15 seconds" onPress={onSkipBack} style={styles.iconButton}>
            <SymbolView name={{ ios: 'gobackward.15' }} size={compact ? 24 : 28} tintColor={VoiceMemosColors.text} />
          </Pressable>
          <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} onPress={onPlayPause} style={styles.playButton}>
            <SymbolView
              name={{ ios: isPlaying ? 'pause.fill' : 'play.fill' }}
              size={compact ? 28 : 34}
              tintColor={VoiceMemosColors.text}
            />
          </Pressable>
          <Pressable accessibilityLabel="Skip forward 15 seconds" onPress={onSkipForward} style={styles.iconButton}>
            <SymbolView name={{ ios: 'goforward.15' }} size={compact ? 24 : 28} tintColor={VoiceMemosColors.text} />
          </Pressable>
        </View>
        {showTimeLabels ? <Text style={styles.time}>{formatDuration(duration)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  progressTrack: {
    height: 3,
    backgroundColor: VoiceMemosColors.waveformInactive,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: VoiceMemosColors.accent,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  time: {
    width: 52,
    fontSize: 12,
    color: VoiceMemosColors.secondaryText,
    fontVariant: ['tabular-nums'],
  },
});
