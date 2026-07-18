import { getAppSettingsFile } from '@/src/storage/paths';
import {
  DEFAULT_METRONOME_SETTINGS,
  DEFAULT_PRECOUNT_MODE,
  normalizeMetronomeSettings,
  normalizePrecountMode,
  type PrecountMode,
} from '@/src/storage/types';

export type ThemePreference = 'system' | 'light' | 'dark';

export type RecordingDefaults = {
  precount: PrecountMode;
  metronomeEnabled: boolean;
  bpm: number;
};

export type AppSettings = {
  locationBasedNaming: boolean;
  themePreference: ThemePreference;
  recordingDefaults: RecordingDefaults;
};

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const DEFAULT_RECORDING_DEFAULTS: RecordingDefaults = {
  precount: DEFAULT_PRECOUNT_MODE,
  metronomeEnabled: DEFAULT_METRONOME_SETTINGS.enabled,
  bpm: DEFAULT_METRONOME_SETTINGS.bpm,
};

const DEFAULT_SETTINGS: AppSettings = {
  locationBasedNaming: true,
  themePreference: 'system',
  recordingDefaults: DEFAULT_RECORDING_DEFAULTS,
};

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);
}

function normalizeRecordingDefaults(value: unknown): RecordingDefaults {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_RECORDING_DEFAULTS };
  }
  const parsed = value as Partial<RecordingDefaults>;
  const metronome = normalizeMetronomeSettings({
    enabled: typeof parsed.metronomeEnabled === 'boolean' ? parsed.metronomeEnabled : undefined,
    bpm: typeof parsed.bpm === 'number' ? parsed.bpm : undefined,
  });
  return {
    precount:
      parsed.precount === 'sound' || parsed.precount === 'silent' || parsed.precount === 'off'
        ? normalizePrecountMode(parsed.precount)
        : DEFAULT_RECORDING_DEFAULTS.precount,
    metronomeEnabled: metronome.enabled,
    bpm: metronome.bpm,
  };
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
      recordingDefaults: normalizeRecordingDefaults(parsed.recordingDefaults),
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      recordingDefaults: { ...DEFAULT_RECORDING_DEFAULTS },
    };
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

export function getRecordingDefaultsSync(): RecordingDefaults {
  return readSettings().recordingDefaults;
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

export async function setRecordingDefaults(
  defaults: RecordingDefaults
): Promise<AppSettings> {
  const next = {
    ...readSettings(),
    recordingDefaults: normalizeRecordingDefaults(defaults),
  };
  writeSettings(next);
  return next;
}
