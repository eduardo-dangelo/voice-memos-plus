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

/**
 * Opens a document picker that only enables Voice Memos Plus `.vmp` project files.
 * Requires a native rebuild after adding this module.
 */
export async function pickProjectAsync(): Promise<PickProjectResult> {
  const module = getModule();
  if (!module?.isAvailable()) {
    throw new Error(
      'Project import is not available. Rebuild the app with npx expo run:ios so the ProjectDocumentPicker native module is linked.'
    );
  }

  return module.pickProjectAsync();
}
