import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

type WaveformBarsSvgProps = {
  color: string;
  height: number;
  loopedColor?: string;
  loopedPath?: string;
  originX: number;
  path: string;
  width: number;
};

export const WaveformBarsSvg = memo(function WaveformBarsSvg({
  color,
  height,
  loopedColor,
  loopedPath,
  originX,
  path,
  width,
}: WaveformBarsSvgProps) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  return (
    <Svg
      height={height}
      pointerEvents="none"
      style={{ position: 'absolute', left: originX, top: 0, width, height }}
      width={width}>
      {path ? <Path d={path} fill={color} /> : null}
      {loopedPath ? <Path d={loopedPath} fill={loopedColor ?? color} /> : null}
    </Svg>
  );
});
