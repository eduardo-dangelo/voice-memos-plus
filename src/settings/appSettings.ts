import { getAppSettingsFile } from '@/src/storage/paths';

export type AppSettings = {
  locationBasedNaming: boolean;
};

const DEFAULT_SETTINGS: AppSettings = {
  locationBasedNaming: true,
};

function readSettings(): AppSettings {
  const file = getAppSettingsFile();
  try {
    const parsed = JSON.parse(file.textSync()) as Partial<AppSettings>;
    return {
      locationBasedNaming:
        typeof parsed.locationBasedNaming === 'boolean'
          ? parsed.locationBasedNaming
          : DEFAULT_SETTINGS.locationBasedNaming,
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

export async function setLocationBasedNaming(enabled: boolean): Promise<AppSettings> {
  const next = { ...readSettings(), locationBasedNaming: enabled };
  writeSettings(next);
  return next;
}
