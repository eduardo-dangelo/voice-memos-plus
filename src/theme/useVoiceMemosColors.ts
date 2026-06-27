import { useMemo } from 'react';

import { useColorScheme } from '@/components/useColorScheme';
import {
  VoiceMemosColorsDark,
  VoiceMemosColorsLight,
  type VoiceMemosColorScheme,
} from '@/constants/VoiceMemosColors';

export function useVoiceMemosColors(): VoiceMemosColorScheme {
  const scheme = useColorScheme();
  return useMemo(
    () => (scheme === 'dark' ? VoiceMemosColorsDark : VoiceMemosColorsLight),
    [scheme]
  );
}
