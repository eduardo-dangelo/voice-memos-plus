import { Appearance } from 'react-native';

import type { ThemePreference } from '@/src/settings/appSettings';

export function applyThemePreference(pref: ThemePreference) {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}
