export const VoiceMemosColors = {
  background: '#FFFFFF',
  text: '#000000',
  secondaryText: '#8E8E93',
  accent: '#007AFF',
  recordRed: '#FF3B30',
  separator: '#C6C6C8',
  waveform: '#007AFF',
  waveformInactive: '#D1D1D6',
  waveformBandBackground: '#F2F2F2',
  waveformDimBackground: '#f8f8f8',
  waveformBar: '#b6b6b6',
  waveformMarkerBackground: '#FFFFFF',
  waveformCenterLine: 'rgba(0, 0, 0, 0.12)',
  loopBandBackground: '#f0f0f0',
  waveformSelectedBandBackground: 'rgba(0, 122, 255, 0.08)',
};

export const DEFAULT_TRACK_COLOR = VoiceMemosColors.accent;

export const TRACK_COLOR_OPTIONS = [
  '#007AFF',
  '#32ADE6',
  '#64D2FF',
  '#5AC8FA',
  '#00C7BE',
  '#34C759',
  '#FFCC00',
  '#FFD60A',
  '#FF9500',
  '#FF3B30',
  '#FF2D55',
  '#AF52DE',
  '#BF5AF2',
  '#5856D6',
  '#A2845E',
  '#AC8E68',
  '#8E8E93',
  '#636366',
] as const;

export type TrackColor = (typeof TRACK_COLOR_OPTIONS)[number];

const TRACK_COLOR_SET = new Set<string>(TRACK_COLOR_OPTIONS);

export function isTrackColorAllowed(color: string): color is TrackColor {
  return TRACK_COLOR_SET.has(color);
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
