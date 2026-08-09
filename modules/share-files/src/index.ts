import { requireNativeModule } from 'expo-modules-core';

type ShareFilesNativeModule = {
  isAvailable(): boolean;
  shareFilesAsync(urls: string[]): Promise<void>;
};

let nativeModule: ShareFilesNativeModule | null = null;

function getModule(): ShareFilesNativeModule | null {
  if (nativeModule) {
    return nativeModule;
  }

  try {
    nativeModule = requireNativeModule<ShareFilesNativeModule>('ShareFiles');
    return nativeModule;
  } catch {
    return null;
  }
}

/**
 * Presents the system share sheet with one or more local file URIs in a single sheet.
 * Requires a native rebuild after adding this module.
 */
export async function shareFilesAsync(uris: string[]): Promise<void> {
  if (uris.length === 0) {
    throw new Error('No files to share.');
  }

  const module = getModule();
  if (!module?.isAvailable()) {
    throw new Error(
      'Multi-file share is not available. Rebuild the app with npx expo run:ios so the ShareFiles native module is linked.'
    );
  }

  await module.shareFilesAsync(uris);
}
