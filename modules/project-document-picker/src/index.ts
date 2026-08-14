import { requireNativeModule } from 'expo-modules-core';

export type PickProjectCanceled = {
  canceled: true;
};

export type PickProjectSuccess = {
  canceled: false;
  uri: string;
  name: string;
};

export type PickProjectResult = PickProjectCanceled | PickProjectSuccess;

type ProjectDocumentPickerNativeModule = {
  isAvailable(): boolean;
  pickProjectAsync(): Promise<PickProjectResult>;
  copyIncomingProjectAsync(uri: string): Promise<string>;
  stampProjectTypeAsync(uri: string): Promise<void>;
};

let nativeModule: ProjectDocumentPickerNativeModule | null = null;

function getModule(): ProjectDocumentPickerNativeModule | null {
  if (nativeModule) {
    return nativeModule;
  }

  try {
    nativeModule = requireNativeModule<ProjectDocumentPickerNativeModule>(
      'ProjectDocumentPicker'
    );
    return nativeModule;
  } catch {
    return null;
  }
}

function requireAvailableModule(): ProjectDocumentPickerNativeModule {
  const module = getModule();
  if (!module?.isAvailable()) {
    throw new Error(
      'Project import is not available. Rebuild the app with npx expo run:ios so the ProjectDocumentPicker native module is linked.'
    );
  }
  return module;
}

/**
 * Opens a document picker that only enables Voice Memos Plus `.vmp` project files.
 * Requires a native rebuild after adding this module.
 */
export async function pickProjectAsync(): Promise<PickProjectResult> {
  return requireAvailableModule().pickProjectAsync();
}

/** Copy a Files / Mail / AirDrop `.vmp` URL into caches, including security-scoped URLs. */
export async function copyIncomingProjectAsync(uri: string): Promise<string> {
  return requireAvailableModule().copyIncomingProjectAsync(uri);
}

/** Stamp a local `.vmp` file with the project UTI so Files / AirDrop keep the type. */
export async function stampProjectTypeAsync(uri: string): Promise<void> {
  await requireAvailableModule().stampProjectTypeAsync(uri);
}
