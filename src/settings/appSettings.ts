import { getAppSettingsFile } from '@/src/storage/paths';

export type ThemePreference = 'system' | 'light' | 'dark';

export type AppSettings = {
  locationBasedNaming: boolean;
  themePreference: ThemePreference;
};

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const DEFAULT_SETTINGS: AppSettings = {
  locationBasedNaming: true,
  themePreference: 'system',
};

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);
}

function readSettings(): AppSettings {
  const file = getAppSettingsFile();
  try {
    const parsed = JSON.parse(file.textSync()) as Partial<AppSettings>;
    return {
      locationBasedNaming:
        typeof parsed.locationBasedNaming === 'boolean'
          ? parsed.locationBasedNaming
          : DEFAULT_SETTINGS.locationBasedNaming,
      themePreference: isThemePreference(parsed.themePreference)
        ? parsed.themePreference
        : DEFAULT_SETTINGS.themePreference,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: AppSettings): void {
  const file = getAppSettingsFile();
  file.write(JSON.stringify(settings, null, 2));
}

export async function getAppSettings(): Promise<AppSettings> {
  return readSettings();
}

export function getThemePreferenceSync(): ThemePreference {
  return readSettings().themePreference;
}

export async function setLocationBasedNaming(enabled: boolean): Promise<AppSettings> {
  const next = { ...readSettings(), locationBasedNaming: enabled };
  writeSettings(next);
  return next;
}

export async function setThemePreference(pref: ThemePreference): Promise<AppSettings> {
  const next = { ...readSettings(), themePreference: pref };
  writeSettings(next);
  return next;
}
