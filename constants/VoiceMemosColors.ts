export const VoiceMemosColorsLight = {
  background: '#FFFFFF',
  sheetBackground: '#FFFFFF',
  text: '#000000',
  secondaryText: '#8E8E93',
  accent: '#007AFF',
  recordRed: '#FF3B30',
  separator: '#C6C6C8',
  searchFieldBackground: '#EFEFF0',
  waveform: '#007AFF',
  waveformInactive: '#D1D1D6',
  waveformBandBackground: '#F2F2F2',
  waveformDimBackground: '#f8f8f8',
  waveformBar: '#b6b6b6',
  waveformMarkerBackground: '#FFFFFF',
  waveformCenterLine: 'rgba(0, 0, 0, 0.12)',
  loopBandBackground: '#f0f0f0',
  waveformSelectedBandBackground: 'rgba(0, 122, 255, 0.08)',
  editorCanvasBackground: '#F2F2F7',
  pillBackground: '#E5E5EA',
  pillBackgroundSelected: '#007AFF',
  pillText: '#000000',
  pillTextSelected: '#FFFFFF',
  sliderTrack: '#E5E5EA',
  sliderThumb: '#FFFFFF',
  chartGrid: 'rgba(0, 0, 0, 0.08)',
  chartAxis: '#8E8E93',
  overlayBackground: 'rgba(0, 0, 0, 0.4)',
  trimDimOverlay: 'rgba(255, 255, 255, 0.55)',
  toolSelectedBackground: 'rgba(0, 122, 255, 0.12)',
};

export const VoiceMemosColorsDark = {
  background: '#000000',
  sheetBackground: '#1C1C1E',
  text: '#FFFFFF',
  secondaryText: '#8E8E93',
  accent: '#0A84FF',
  recordRed: '#FF453A',
  separator: '#38383A',
  searchFieldBackground: '#1C1C1E',
  waveform: '#0A84FF',
  waveformInactive: '#48484A',
  waveformBandBackground: '#1C1C1E',
  waveformDimBackground: '#242426',
  waveformBar: '#636366',
  waveformMarkerBackground: '#1C1C1E',
  waveformCenterLine: 'rgba(255, 255, 255, 0.12)',
  loopBandBackground: '#161618',
  waveformSelectedBandBackground: 'rgba(10, 132, 255, 0.15)',
  editorCanvasBackground: '#1C1C1E',
  pillBackground: '#2C2C2E',
  pillBackgroundSelected: '#0A84FF',
  pillText: '#FFFFFF',
  pillTextSelected: '#FFFFFF',
  sliderTrack: '#38383A',
  sliderThumb: '#FFFFFF',
  chartGrid: 'rgba(255, 255, 255, 0.08)',
  chartAxis: '#8E8E93',
  overlayBackground: 'rgba(0, 0, 0, 0.6)',
  trimDimOverlay: 'rgba(0, 0, 0, 0.45)',
  toolSelectedBackground: 'rgba(10, 132, 255, 0.2)',
};

/** @deprecated Use useVoiceMemosColors() in components. Kept for non-React modules. */
export const VoiceMemosColors = VoiceMemosColorsLight;

export type VoiceMemosColorScheme = typeof VoiceMemosColorsLight;

export const DEFAULT_TRACK_COLOR = VoiceMemosColorsLight.accent;

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
