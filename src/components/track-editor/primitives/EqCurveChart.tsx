import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type ViewStyle,
} from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import {
  EQ_FREQUENCIES,
  formatEqBand,
  formatFrequency,
  type LayerEffects,
} from '@/src/audio/layerEffects';

const MIN_DB = -12;
const MAX_DB = 12;
const MIN_FREQ = EQ_FREQUENCIES[0];
const MAX_FREQ = EQ_FREQUENCIES[EQ_FREQUENCIES.length - 1];
const STEP_COUNT = 100;
const HANDLE_RADIUS = 10;
const ACTIVE_HANDLE_RADIUS = 12;
const HIT_RADIUS = 22;
const CHART_HEIGHT = 110;
const CHART_PADDING_X = 16;
const CHART_PADDING_Y = 8;
const CURVE_STROKE = 2;
const TAP_MOVE_THRESHOLD = 6;
const TAP_DURATION_MS = 280;

type Props = {
  bands: LayerEffects['eq']['bands'];
  onChange: (index: number, value: number) => void;
};

type ChartSize = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantizeDb(value: number): number {
  const step = (MAX_DB - MIN_DB) / STEP_COUNT;
  const steps = Math.round((value - MIN_DB) / step);
  return clamp(MIN_DB + steps * step, MIN_DB, MAX_DB);
}

function freqToNormalized(freq: number): number {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  return (Math.log10(freq) - minLog) / (maxLog - minLog);
}

function dbToNormalized(db: number): number {
  return (MAX_DB - db) / (MAX_DB - MIN_DB);
}

function getChartInner(size: ChartSize) {
  const innerWidth = Math.max(1, size.width - CHART_PADDING_X * 2);
  const innerHeight = Math.max(1, size.height - CHART_PADDING_Y * 2);
  return { innerWidth, innerHeight };
}

function freqToX(freq: number, size: ChartSize): number {
  const { innerWidth } = getChartInner(size);
  return CHART_PADDING_X + freqToNormalized(freq) * innerWidth;
}

function dbToY(db: number, size: ChartSize): number {
  const { innerHeight } = getChartInner(size);
  return CHART_PADDING_Y + dbToNormalized(db) * innerHeight;
}

function getBandPoints(bands: LayerEffects['eq']['bands'], size: ChartSize): Point[] {
  return bands.map((db, index) => ({
    x: freqToX(EQ_FREQUENCIES[index], size),
    y: dbToY(db, size),
  }));
}

function findNearestBandIndex(
  locationX: number,
  locationY: number,
  bands: LayerEffects['eq']['bands'],
  size: ChartSize
): number {
  const points = getBandPoints(bands, size);
  let nearestIndex = 0;
  let nearestDistance = Infinity;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const distance = Math.hypot(locationX - point.x, locationY - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  if (nearestDistance <= HIT_RADIUS) {
    return nearestIndex;
  }

  let nearestXDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const xDistance = Math.abs(locationX - points[index].x);
    if (xDistance < nearestXDistance) {
      nearestXDistance = xDistance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function ChartSegmentLine({
  x1,
  y1,
  x2,
  y2,
  color,
  strokeWidth,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) {
    return null;
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.segmentLine,
        {
          width: length,
          height: strokeWidth,
          left: centerX - length / 2,
          top: centerY - strokeWidth / 2,
          backgroundColor: color,
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
    />
  );
}

function ChartAreaFill({
  points,
  baselineY,
}: {
  points: Point[];
  baselineY: number;
}) {
  if (points.length < 2) {
    return null;
  }

  const strips: ReactNode[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const span = Math.max(1, Math.ceil(end.x - start.x));
    for (let step = 0; step < span; step += 1) {
      const t = step / span;
      const x = start.x + t * (end.x - start.x);
      const curveY = start.y + t * (end.y - start.y);
      const top = Math.min(curveY, baselineY);
      const height = Math.abs(curveY - baselineY);
      if (height < 0.5) {
        continue;
      }
      strips.push(
        <View
          key={`${index}-${step}`}
          pointerEvents="none"
          style={[
            styles.areaStrip,
            {
              left: x,
              top,
              height,
            },
          ]}
        />
      );
    }
  }

  return <>{strips}</>;
}

function ChartHandle({
  point,
  isActive,
}: {
  point: Point;
  isActive: boolean;
}) {
  const radius = isActive ? ACTIVE_HANDLE_RADIUS : HANDLE_RADIUS;
  const size = radius * 2;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.handle,
        {
          width: size,
          height: size,
          borderRadius: radius,
          left: point.x - radius,
          top: point.y - radius,
          borderWidth: isActive ? 2.5 : 2,
        },
      ]}
    />
  );
}

export function EqCurveChart({ bands, onChange }: Props) {
  const [chartSize, setChartSize] = useState<ChartSize>({ width: 1, height: CHART_HEIGHT });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const bandsRef = useRef(bands);
  const onChangeRef = useRef(onChange);
  const chartSizeRef = useRef(chartSize);
  const activeIndexRef = useRef<number | null>(null);
  const startDbRef = useRef(0);
  const grantTimeRef = useRef(0);

  bandsRef.current = bands;
  onChangeRef.current = onChange;
  chartSizeRef.current = chartSize;
  activeIndexRef.current = activeIndex;

  const points = useMemo(() => getBandPoints(bands, chartSize), [bands, chartSize]);
  const baselineY = dbToY(0, chartSize);
  const gridLines = [-6, 0, 6];

  const applyDrag = (gesture: PanResponderGestureState) => {
    const index = activeIndexRef.current;
    if (index == null) {
      return;
    }
    const { innerHeight } = getChartInner(chartSizeRef.current);
    const deltaDb = (-gesture.dy / innerHeight) * (MAX_DB - MIN_DB);
    const next = quantizeDb(startDbRef.current + deltaDb);
    onChangeRef.current(index, next);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const { locationX, locationY } = event.nativeEvent;
        const index = findNearestBandIndex(
          locationX,
          locationY,
          bandsRef.current,
          chartSizeRef.current
        );
        activeIndexRef.current = index;
        setActiveIndex(index);
        startDbRef.current = bandsRef.current[index];
        grantTimeRef.current = Date.now();
      },
      onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        applyDrag(gesture);
      },
      onPanResponderRelease: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const index = activeIndexRef.current;
        const duration = Date.now() - grantTimeRef.current;
        const isTap =
          Math.abs(gesture.dy) < TAP_MOVE_THRESHOLD &&
          Math.abs(gesture.dx) < TAP_MOVE_THRESHOLD &&
          duration < TAP_DURATION_MS;

        if (isTap && index != null) {
          onChangeRef.current(index, 0);
        }

        activeIndexRef.current = null;
        setActiveIndex(null);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setChartSize({ width, height });
  };

  const activeLabel =
    activeIndex != null
      ? `${formatFrequency(EQ_FREQUENCIES[activeIndex])}  ${formatEqBand(bands[activeIndex])}`
      : ' ';

  return (
    <View style={styles.container}>
      <Text style={styles.activeLabel}>{activeLabel}</Text>
      <View
        style={styles.chartTouchArea}
        onLayout={handleLayout}
        {...panResponder.panHandlers}>
        <View style={[styles.chartCanvas, { width: chartSize.width, height: chartSize.height }]}>
          {gridLines.map((db) => (
            <View
              key={db}
              pointerEvents="none"
              style={[
                styles.gridLine,
                {
                  top: dbToY(db, chartSize),
                  left: CHART_PADDING_X,
                  right: CHART_PADDING_X,
                  backgroundColor:
                    db === 0 ? VoiceMemosColors.waveformCenterLine : VoiceMemosColors.waveformInactive,
                  height: db === 0 ? 1.5 : 1,
                  opacity: db === 0 ? 1 : 0.6,
                } as ViewStyle,
              ]}
            />
          ))}
          <ChartAreaFill points={points} baselineY={baselineY} />
          {points.map((point, index) => {
            if (index === points.length - 1) {
              return null;
            }
            const next = points[index + 1];
            return (
              <ChartSegmentLine
                key={`curve-${EQ_FREQUENCIES[index]}`}
                x1={point.x}
                y1={point.y}
                x2={next.x}
                y2={next.y}
                color={VoiceMemosColors.accent}
                strokeWidth={CURVE_STROKE}
              />
            );
          })}
          {points.map((point, index) => (
            <ChartHandle key={EQ_FREQUENCIES[index]} point={point} isActive={activeIndex === index} />
          ))}
        </View>
      </View>
      <View style={styles.freqRow}>
        {EQ_FREQUENCIES.map((freq) => (
          <Text
            key={freq}
            style={[styles.freqLabel, { left: freqToX(freq, chartSize) - 12 }]}>
            {formatFrequency(freq)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  activeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: VoiceMemosColors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    minHeight: 14,
  },
  chartTouchArea: {
    height: CHART_HEIGHT,
    width: '100%',
  },
  chartCanvas: {
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
  },
  areaStrip: {
    position: 'absolute',
    width: 1,
    backgroundColor: VoiceMemosColors.accent,
    opacity: 0.18,
  },
  segmentLine: {
    position: 'absolute',
  },
  handle: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderColor: VoiceMemosColors.accent,
  },
  freqRow: {
    height: 14,
    position: 'relative',
    width: '100%',
  },
  freqLabel: {
    position: 'absolute',
    width: 24,
    fontSize: 10,
    color: VoiceMemosColors.secondaryText,
    textAlign: 'center',
  },
});
