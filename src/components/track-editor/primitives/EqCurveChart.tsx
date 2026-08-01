import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import {
  clampEqBandFrequency,
  clampEqQ,
  EQ_DEFAULT_Q,
  EQ_FREQUENCIES,
  EQ_MAX_FREQ,
  EQ_MAX_Q,
  EQ_MIN_FREQ,
  EQ_MIN_Q,
  formatEqBand,
  formatFrequency,
  type EqBandFrequencies,
  type EqBandGains,
  type EqBandQFactors,
} from '@/src/audio/layerEffects';

import { EditorSlider } from './EditorSlider';

const MIN_DB = -12;
const MAX_DB = 12;
const MIN_FREQ = EQ_MIN_FREQ;
const MAX_FREQ = EQ_MAX_FREQ;
const STEP_COUNT = 100;
const RESPONSE_SAMPLES = 96;
const RESPONSE_SAMPLE_RATE = 48000;
const HANDLE_RADIUS = 10;
const ACTIVE_HANDLE_RADIUS = 12;
const HIT_RADIUS = 22;
const CHART_HEIGHT = 148;
const CHART_PADDING_X = 16;
const CHART_PADDING_Y = 16;
const CURVE_STROKE = 2;
const FILL_OPACITY = 0.18;
const TAP_MOVE_THRESHOLD = 6;
const TAP_DURATION_MS = 280;
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_THRESHOLD = 8;
/** Center band (1 kHz) is pre-selected when the custom EQ editor mounts. */
const DEFAULT_SELECTED_BAND = 2;

export type EqBandChange = {
  gain?: number;
  frequency?: number;
  q?: number;
};

type Props = {
  bands: EqBandGains;
  frequencies: EqBandFrequencies;
  qFactors: EqBandQFactors;
  onChange: (index: number, change: EqBandChange) => void;
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

function normalizedToFreq(normalized: number): number {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  return Math.pow(10, minLog + clamp(normalized, 0, 1) * (maxLog - minLog));
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

function xToFreq(x: number, size: ChartSize): number {
  const { innerWidth } = getChartInner(size);
  const normalized = (x - CHART_PADDING_X) / innerWidth;
  return normalizedToFreq(normalized);
}

function dbToY(db: number, size: ChartSize): number {
  const { innerHeight } = getChartInner(size);
  return CHART_PADDING_Y + dbToNormalized(db) * innerHeight;
}

function getBandPoints(
  bands: EqBandGains,
  frequencies: EqBandFrequencies,
  size: ChartSize
): Point[] {
  return bands.map((db, index) => ({
    x: freqToX(frequencies[index], size),
    y: dbToY(db, size),
  }));
}

/** Peaking biquad magnitude (dB) at frequency f — Audio EQ Cookbook. */
function peakingMagDb(
  f: number,
  f0: number,
  gainDb: number,
  Q: number,
  sampleRate = RESPONSE_SAMPLE_RATE
): number {
  if (f <= 0 || f0 <= 0 || Q <= 0 || Math.abs(gainDb) < 1e-4) {
    return 0;
  }
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosw0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha / A;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  const w = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w);
  const sinw = Math.sin(w);
  const z1r = cosw;
  const z1i = -sinw;
  const z2r = cosw * cosw - sinw * sinw;
  const z2i = -2 * cosw * sinw;

  const br = nb0 + nb1 * z1r + nb2 * z2r;
  const bi = nb1 * z1i + nb2 * z2i;
  const ar = 1 + na1 * z1r + na2 * z2r;
  const ai = na1 * z1i + na2 * z2i;
  const mag2 = (br * br + bi * bi) / Math.max(1e-20, ar * ar + ai * ai);
  return 10 * Math.log10(mag2);
}

function sampleResponsePoints(
  bands: EqBandGains,
  frequencies: EqBandFrequencies,
  qFactors: EqBandQFactors,
  size: ChartSize
): Point[] {
  const points: Point[] = [];
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  for (let i = 0; i < RESPONSE_SAMPLES; i += 1) {
    const t = i / (RESPONSE_SAMPLES - 1);
    const freq = Math.pow(10, minLog + t * (maxLog - minLog));
    let db = 0;
    for (let band = 0; band < bands.length; band += 1) {
      db += peakingMagDb(freq, frequencies[band], bands[band], qFactors[band]);
    }
    db = clamp(db, MIN_DB, MAX_DB);
    points.push({ x: freqToX(freq, size), y: dbToY(db, size) });
  }
  return points;
}

function buildCurvePath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    d += ` L ${points[index].x} ${points[index].y}`;
  }
  return d;
}

function buildAreaPath(points: Point[], baselineY: number): string {
  if (points.length < 2) {
    return '';
  }
  const first = points[0];
  const last = points[points.length - 1];
  return `${buildCurvePath(points)} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function findNearestBandIndex(
  locationX: number,
  locationY: number,
  bands: EqBandGains,
  frequencies: EqBandFrequencies,
  size: ChartSize
): number {
  const points = getBandPoints(bands, frequencies, size);
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

function ChartHandle({
  point,
  isActive,
  handleStyle,
}: {
  point: Point;
  isActive: boolean;
  handleStyle: { position: 'absolute'; backgroundColor: string; borderColor: string };
}) {
  const radius = isActive ? ACTIVE_HANDLE_RADIUS : HANDLE_RADIUS;
  const size = radius * 2;

  return (
    <View
      pointerEvents="none"
      style={[
        handleStyle,
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

function formatQ(q: number): string {
  return q >= 10 ? q.toFixed(0) : q.toFixed(1);
}

const EQ_Q_LOG_SPAN = Math.log(EQ_MAX_Q / EQ_MIN_Q);

function qToSliderPos(q: number): number {
  return Math.log(clampEqQ(q) / EQ_MIN_Q) / EQ_Q_LOG_SPAN;
}

function sliderPosToQ(pos: number): number {
  const t = Math.max(0, Math.min(1, pos));
  return clampEqQ(EQ_MIN_Q * Math.pow(EQ_MAX_Q / EQ_MIN_Q, t));
}

export function EqCurveChart({ bands, frequencies, qFactors, onChange }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const [chartSize, setChartSize] = useState<ChartSize>({ width: 1, height: CHART_HEIGHT });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [qEditIndex, setQEditIndex] = useState<number | null>(DEFAULT_SELECTED_BAND);

  const bandsRef = useRef(bands);
  const frequenciesRef = useRef(frequencies);
  const qFactorsRef = useRef(qFactors);
  const onChangeRef = useRef(onChange);
  const chartSizeRef = useRef(chartSize);
  const activeIndexRef = useRef<number | null>(null);
  const startDbRef = useRef(0);
  const startFreqRef = useRef(EQ_MIN_FREQ);
  const grantTimeRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const dragStartedRef = useRef(false);
  const qEditIndexRef = useRef<number | null>(null);

  bandsRef.current = bands;
  frequenciesRef.current = frequencies;
  qFactorsRef.current = qFactors;
  onChangeRef.current = onChange;
  chartSizeRef.current = chartSize;
  activeIndexRef.current = activeIndex;
  qEditIndexRef.current = qEditIndex;

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const handlePoints = useMemo(
    () => getBandPoints(bands, frequencies, chartSize),
    [bands, frequencies, chartSize]
  );
  const responsePoints = useMemo(
    () => sampleResponsePoints(bands, frequencies, qFactors, chartSize),
    [bands, frequencies, qFactors, chartSize]
  );
  const { innerHeight } = getChartInner(chartSize);
  const fillBaselineY = CHART_PADDING_Y + innerHeight;
  const gridLines = [-6, 0, 6];

  const curvePath = useMemo(() => buildCurvePath(responsePoints), [responsePoints]);
  const areaPath = useMemo(
    () => buildAreaPath(responsePoints, fillBaselineY),
    [responsePoints, fillBaselineY]
  );

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const applyDrag = (gesture: PanResponderGestureState) => {
    if (longPressFiredRef.current) {
      return;
    }
    const index = activeIndexRef.current;
    if (index == null) {
      return;
    }
    const size = chartSizeRef.current;
    const { innerHeight: height } = getChartInner(size);
    const deltaDb = (-gesture.dy / height) * (MAX_DB - MIN_DB);
    const nextGain = quantizeDb(startDbRef.current + deltaDb);
    const startX = freqToX(startFreqRef.current, size);
    const nextFrequency = clampEqBandFrequency(
      index,
      xToFreq(startX + gesture.dx, size),
      frequenciesRef.current
    );
    onChangeRef.current(index, { gain: nextGain, frequency: nextFrequency });
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
          frequenciesRef.current,
          chartSizeRef.current
        );
        activeIndexRef.current = index;
        setActiveIndex(index);
        // Selecting / moving a knob reveals the Wide–Narrow Q slider for that band.
        setQEditIndex(index);
        qEditIndexRef.current = index;
        startDbRef.current = bandsRef.current[index];
        startFreqRef.current = frequenciesRef.current[index];
        grantTimeRef.current = Date.now();
        longPressFiredRef.current = false;
        dragStartedRef.current = false;
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          dragStartedRef.current = false;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setActiveIndex(null);
          activeIndexRef.current = null;
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        if (longPressFiredRef.current) {
          return;
        }
        const moved =
          Math.abs(gesture.dx) > LONG_PRESS_MOVE_THRESHOLD ||
          Math.abs(gesture.dy) > LONG_PRESS_MOVE_THRESHOLD;
        if (moved) {
          clearLongPressTimer();
          dragStartedRef.current = true;
          applyDrag(gesture);
        }
      },
      onPanResponderRelease: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        clearLongPressTimer();
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          return;
        }
        const index = activeIndexRef.current;
        const duration = Date.now() - grantTimeRef.current;
        const isTap =
          !dragStartedRef.current &&
          Math.abs(gesture.dy) < TAP_MOVE_THRESHOLD &&
          Math.abs(gesture.dx) < TAP_MOVE_THRESHOLD &&
          duration < TAP_DURATION_MS;

        if (isTap && index != null) {
          onChangeRef.current(index, { gain: 0 });
        }

        activeIndexRef.current = null;
        setActiveIndex(null);
        dragStartedRef.current = false;
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer();
        longPressFiredRef.current = false;
        dragStartedRef.current = false;
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
      ? `${formatFrequency(frequencies[activeIndex])}  ${formatEqBand(bands[activeIndex])}`
      : qEditIndex != null
        ? `${formatFrequency(frequencies[qEditIndex])}  Q ${formatQ(qFactors[qEditIndex])}`
        : ' ';

  const qSliderEnabled = qEditIndex != null;
  const qValue = qSliderEnabled ? qFactors[qEditIndex] : EQ_DEFAULT_Q;

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
                    db === 0 ? colors.waveformCenterLine : colors.waveformInactive,
                  height: db === 0 ? 1.5 : 1,
                  opacity: db === 0 ? 1 : 0.6,
                } as ViewStyle,
              ]}
            />
          ))}
          {EQ_FREQUENCIES.map((freq) => {
            const x = freqToX(freq, chartSize);
            return (
              <View
                key={`vguide-${freq}`}
                pointerEvents="none"
                style={[
                  styles.verticalGuide,
                  {
                    left: x,
                    top: CHART_PADDING_Y,
                    height: innerHeight,
                    backgroundColor: colors.waveformInactive,
                  },
                ]}
              />
            );
          })}
          {chartSize.width > 1 ? (
            <Svg
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              width={chartSize.width}
              height={chartSize.height}>
              <Path d={areaPath} fill={colors.accent} fillOpacity={FILL_OPACITY} />
              <Path
                d={curvePath}
                fill="none"
                stroke={colors.accent}
                strokeWidth={CURVE_STROKE}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </Svg>
          ) : null}
          {handlePoints.map((point, index) => (
            <ChartHandle
              key={`handle-${index}`}
              point={point}
              isActive={activeIndex === index || qEditIndex === index}
              handleStyle={styles.handle}
            />
          ))}
        </View>
      </View>
      <View style={styles.freqRow}>
        {EQ_FREQUENCIES.map((freq) => (
          <Text
            key={`freq-${freq}`}
            style={[styles.freqLabel, { left: freqToX(freq, chartSize) - 14 }]}>
            {formatFrequency(freq)}
          </Text>
        ))}
      </View>
      <View style={styles.qPanel}>
        <View style={styles.qSliderRow}>
          <Text style={[styles.qEndLabel, !qSliderEnabled && styles.qLabelDisabled]}>Wide</Text>
          <View style={styles.qSliderTrack}>
            <EditorSlider
              disabled={!qSliderEnabled}
              maximumValue={1}
              minimumValue={0}
              value={qToSliderPos(qValue)}
              onSlidingComplete={(pos) => {
                if (qEditIndex == null) {
                  return;
                }
                onChange(qEditIndex, { q: sliderPosToQ(pos) });
              }}
              onValueChange={(pos) => {
                if (qEditIndex == null) {
                  return;
                }
                onChange(qEditIndex, { q: sliderPosToQ(pos) });
              }}
            />
          </View>
          <Text style={[styles.qEndLabel, !qSliderEnabled && styles.qLabelDisabled]}>Narrow</Text>
          <Text style={[styles.qValue, !qSliderEnabled && styles.qLabelDisabled]}>
            {qSliderEnabled ? formatQ(qValue) : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: 6,
        },
        activeLabel: {
          fontSize: 11,
          fontWeight: '600',
          color: colors.text,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
          minHeight: 14,
        },
        qPanel: {
          paddingTop: 4,
        },
        qSliderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        qEndLabel: {
          fontSize: 11,
          color: colors.secondaryText,
          width: 40,
        },
        qLabelDisabled: {
          opacity: 0.45,
        },
        qSliderTrack: {
          flex: 1,
        },
        qValue: {
          width: 28,
          fontSize: 12,
          color: colors.secondaryText,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
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
        verticalGuide: {
          position: 'absolute',
          width: StyleSheet.hairlineWidth,
          opacity: 0.55,
        },
        handle: {
          position: 'absolute',
          backgroundColor: colors.sliderThumb,
          borderColor: colors.accent,
        },
        freqRow: {
          height: 14,
          position: 'relative',
          width: '100%',
        },
        freqLabel: {
          position: 'absolute',
          width: 28,
          fontSize: 10,
          color: colors.secondaryText,
          textAlign: 'center',
        },
      }),
    [colors]
  );
}
