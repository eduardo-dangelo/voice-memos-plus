import { useWindowDimensions } from 'react-native';

/** Minimum width for sidebar + detail (iPad full screen / wide Split View). */
export const REGULAR_WIDTH_BREAKPOINT = 768;

/**
 * Width-based layout class. Prefer this over Platform.isPad so narrow
 * iPad multitasking columns still get the compact (phone) UX.
 */
export function useIsRegularWidth(breakpoint = REGULAR_WIDTH_BREAKPOINT): boolean {
  const { width } = useWindowDimensions();
  return width >= breakpoint;
}
