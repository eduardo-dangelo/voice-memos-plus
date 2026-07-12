import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type RecordingActivityProps = {
  memoId: string;
  recordingStartedAt: number;
  mode: 'new' | 'stack' | 'replace';
  layerId: string | null;
  startTime: number;
  trackColor: string | null;
};

const RecordingActivity = (
  props: RecordingActivityProps,
  _environment: LiveActivityEnvironment
) => {
  'widget';

  const recordRed = '#FF3B30';

  const renderTimer = (size: number, weight: 'semibold' | 'bold' = 'semibold') => {
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

  const renderBanner = (timerSize: number) => (
    <HStack modifiers={[padding({ horizontal: 16, vertical: 14 }), frame({ minHeight: 52 })]}>
      <Image systemName="mic.fill" color={recordRed} size={18} />
      <Spacer />
      {renderTimer(timerSize, 'bold')}
    </HStack>
  );

  return {
    banner: renderBanner(20),
    bannerSmall: renderBanner(16),
    compactLeading: <Image systemName="mic.fill" color={recordRed} size={18} />,
    compactTrailing: renderTimer(14, 'bold'),
    minimal: <Image systemName="mic.fill" color={recordRed} size={14} />,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 8 })]}>
        <Image systemName="mic.fill" color={recordRed} size={22} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(recordRed)]}>Recording</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 8 })]}>{renderTimer(22, 'bold')}</VStack>
    ),
  };
};

export default createLiveActivity('RecordingActivity', RecordingActivity);
