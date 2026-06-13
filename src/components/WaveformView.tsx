import { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { getPeaksForMemo } from '@/src/audio/waveform';

type Props = {
  peaks?: number[];
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (time: number) => void;
  onWidthChange?: (width: number) => void;
  height?: number;
  children?: React.ReactNode;
};

export function WaveformView({
  peaks,
  currentTime,
  duration,
  trimStart,
  trimEnd,
  onSeek,
  onWidthChange,
  height = 120,
  children,
}: Props) {
  const [width, setWidth] = useState(0);
  const normalizedPeaks = useMemo(() => getPeaksForMemo(peaks), [peaks]);
  const effectiveEnd = trimEnd > 0 ? trimEnd : duration;
  const playheadRatio = duration > 0 ? currentTime / duration : 0;
  const trimStartRatio = duration > 0 ? trimStart / duration : 0;
  const trimEndRatio = duration > 0 ? effectiveEnd / duration : 1;

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setWidth(nextWidth);
    onWidthChange?.(nextWidth);
  };

  const handlePress = (locationX: number) => {
    if (duration <= 0 || width <= 0) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, locationX / width));
    onSeek(ratio * duration);
  };

  return (
    <View onLayout={handleLayout} style={[styles.container, { height }]}>
      <Pressable
        onPress={(event) => handlePress(event.nativeEvent.locationX)}
        style={styles.pressable}>
        <View pointerEvents="none" style={[styles.trimOverlay, { left: 0, width: `${trimStartRatio * 100}%` }]} />
        <View
          pointerEvents="none"
          style={[styles.trimOverlay, { right: 0, width: `${(1 - trimEndRatio) * 100}%` }]}
        />
        <View pointerEvents="none" style={styles.barsRow}>
          {normalizedPeaks.map((peak, index) => {
            const barRatio = index / normalizedPeaks.length;
            const isPast = barRatio <= playheadRatio;
            const barHeight = Math.max(4, peak * (height - 20));
            return (
              <View
                key={index}
                style={[
                  styles.bar,
                  {
                    height: barHeight,
                    backgroundColor: isPast
                      ? VoiceMemosColors.waveform
                      : VoiceMemosColors.waveformInactive,
                  },
                ]}
              />
            );
          })}
        </View>
        <View pointerEvents="none" style={[styles.playhead, { left: `${playheadRatio * 100}%` }]} />
        {children}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
  },
  pressable: {
    flex: 1,
    justifyContent: 'center',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 4,
  },
  bar: {
    flex: 1,
    borderRadius: 1,
    minWidth: 2,
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: VoiceMemosColors.text,
  },
  trimOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: VoiceMemosColors.trimOverlay,
    zIndex: 1,
  },
});
