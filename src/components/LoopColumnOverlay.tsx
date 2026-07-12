import { View } from 'react-native';

import { getLoopRegionLayout, LOOP_ENABLED_FILL } from '@/src/components/LoopRegionBar';

const LOOP_COLUMN_BORDER_WIDTH = 2;
const LOOP_COLUMN_FILL_ALPHA = 0.08;

type Props = {
  height: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  sidePadding: number;
  pixelsPerSecond: number;
};

export function LoopColumnOverlay({
  height,
  loopStart,
  loopEnd,
  loopEnabled,
  sidePadding,
  pixelsPerSecond,
}: Props) {
  const layout = getLoopRegionLayout({
    loopStart,
    loopEnd,
    sidePadding,
    pixelsPerSecond,
  });

  if (!layout.hasRegion || !loopEnabled) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: layout.left,
        width: layout.width,
        height,
        borderLeftWidth: LOOP_COLUMN_BORDER_WIDTH,
        borderRightWidth: LOOP_COLUMN_BORDER_WIDTH,
        borderBottomWidth: LOOP_COLUMN_BORDER_WIDTH,
        borderColor: LOOP_ENABLED_FILL,
        backgroundColor: `rgba(255, 204, 0, ${LOOP_COLUMN_FILL_ALPHA})`,
        zIndex: 2,
      }}
    />
  );
}
