import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type RecordingActivityProps = {
  memoId: string;
  memoTitle: string;
  activityKind: 'recording' | 'playback';
  recordingStartedAt: number;
  startTime: number;
  playbackStartedAt: number;
  playbackOffset: number;
  mode: 'new' | 'stack' | 'replace';
  layerId: string | null;
  trackColor: string | null;
};

const RecordingActivity = (
  props: RecordingActivityProps,
  _environment: LiveActivityEnvironment
) => {
  'widget';

  const recordRed = '#FF3B30';
  const playbackTint = '#FFFFFF';
  const title = props.memoTitle || 'Recording';
  const isRecording = props.activityKind === 'recording';

  const renderTitle = (size: number, maxWidth: number) => (
    <Text
      modifiers={[
        font({ size, weight: 'semibold' }),
        foregroundStyle('#FFFFFF'),
        lineLimit(1),
        frame({ maxWidth }),
        padding({ leading: 8 }),
      ]}
    >
      {title}
    </Text>
  );

  const renderRecordingTimer = (size: number, weight: 'semibold' | 'bold' = 'semibold') => {
    const offsetMs = props.startTime * 1000;
    const intervalStart = new Date(props.recordingStartedAt - offsetMs);
    const intervalEnd = new Date(props.recordingStartedAt + 24 * 60 * 60 * 1000);

    return (
      <Text
        timerInterval={{ lower: intervalStart, upper: intervalEnd }}
        countsDown={false}
        modifiers={[
          font({ design: 'monospaced', weight, size }),
          monospacedDigit(),
          foregroundStyle(recordRed),
        ]}
      />
    );
  };

  const renderPlaybackTimer = (size: number, weight: 'semibold' | 'bold' = 'semibold') => {
    const offsetMs = props.playbackOffset * 1000;
    const intervalStart = new Date(props.playbackStartedAt - offsetMs);
    const intervalEnd = new Date(props.playbackStartedAt + 24 * 60 * 60 * 1000);

    return (
      <Text
        timerInterval={{ lower: intervalStart, upper: intervalEnd }}
        countsDown={false}
        modifiers={[
          font({ design: 'monospaced', weight, size }),
          monospacedDigit(),
          foregroundStyle(playbackTint),
        ]}
      />
    );
  };

  const renderTimer = (size: number, weight: 'semibold' | 'bold' = 'semibold') =>
    isRecording ? renderRecordingTimer(size, weight) : renderPlaybackTimer(size, weight);

  const renderLeadingIcon = (size: number) => (
    <Image
      systemName={isRecording ? 'mic.fill' : 'play.fill'}
      color={isRecording ? recordRed : playbackTint}
      size={size}
    />
  );

  const renderBanner = (timerSize: number, titleSize: number, titleMaxWidth: number) => (
    <HStack modifiers={[padding({ horizontal: 16, vertical: 14 }), frame({ minHeight: 52 })]}>
      {renderLeadingIcon(18)}
      <Spacer />
      <HStack modifiers={[padding({ leading: 8 })]}>
        {renderTimer(timerSize, 'bold')}
        {renderTitle(titleSize, titleMaxWidth)}
      </HStack>
    </HStack>
  );

  return {
    banner: renderBanner(20, 15, 180),
    bannerSmall: renderBanner(16, 13, 140),
    compactLeading: renderLeadingIcon(18),
    compactTrailing: renderTitle(12, 100),
    minimal: renderLeadingIcon(14),
    expandedLeading: (
      <VStack modifiers={[padding({ all: 8 })]}>{renderLeadingIcon(22)}</VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 8 })]}>
        {renderTimer(22, 'bold')}
        {renderTitle(12, 200)}
      </VStack>
    ),
  };
};

export default createLiveActivity('RecordingActivity', RecordingActivity);
