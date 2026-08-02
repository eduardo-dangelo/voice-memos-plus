import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';

import { sanitizeExportFileName } from '@/src/utils/format';

import {
  PROJECT_MANIFEST_PATH,
  PROJECT_PACKAGE_META_PATH,
  buildExportableManifest,
  buildPackageMeta,
  encodeProjectJson,
  packagedMediaPath,
  unzipProjectFiles,
  validateProjectArchive,
  zipProjectFiles,
  type ValidatedProjectArchive,
} from './memoPackageFormat';
import { getMemoDir, requireLayerFile, resolveMemoDir } from './paths';
import type { Memo } from './types';
import { hasRecording } from './types';

export {
  PROJECT_FORMAT_ID,
  PROJECT_SCHEMA_VERSION,
  PROJECT_PACKAGE_META_PATH,
  PROJECT_MANIFEST_PATH,
  PROJECT_MEDIA_PREFIX,
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME_TYPE,
  PROJECT_UTI,
  isProjectFileName,
  buildExportableManifest,
  buildPackageMeta,
  mediaBasename,
  packagedMediaPath,
  remapImportedMemo,
  validateProjectArchive,
  zipProjectFiles,
  unzipProjectFiles,
  type MemoProjectPackageMeta,
  type ValidatedProjectArchive,
} from './memoPackageFormat';

function resolveAppVersion(explicit?: string): string | undefined {
  if (explicit) {
    return explicit;
  }
  return Constants.expoConfig?.version ?? undefined;
}

export function writeImportedMemoFiles(
  memo: Memo,
  media: Map<string, Uint8Array>
): void {
  const destDir = getMemoDir(memo.id);
  if (!destDir.exists) {
    destDir.create({ intermediates: true, idempotent: true });
  }

  for (const layer of memo.layers) {
    if (layer.duration <= 0) {
      continue;
    }
    const mediaBytes = media.get(layer.fileName);
    if (!mediaBytes) {
      throw new Error(`Project package is missing media for “${layer.fileName}”.`);
    }
    const dest = new File(destDir, layer.fileName);
    if (dest.exists) {
      dest.delete();
    }
    dest.create();
    dest.write(mediaBytes);
  }

  const manifestFile = new File(destDir, 'manifest.json');
  if (!manifestFile.exists) {
    manifestFile.create();
  }
  manifestFile.write(JSON.stringify(memo, null, 2));
}

/** Pack a memo into a `.vmp` project file in the cache directory. */
export async function packMemoToProjectFile(
  memo: Memo,
  options?: { appVersion?: string }
): Promise<File> {
  if (!hasRecording(memo)) {
    throw new Error('This memo has no recorded audio.');
  }

  const sourceDir = resolveMemoDir(memo.id);
  if (!sourceDir) {
    throw new Error('Memo not found');
  }

  const exportable = buildExportableManifest(memo);
  const meta = buildPackageMeta({ appVersion: resolveAppVersion(options?.appVersion) });
  const archiveFiles: Record<string, Uint8Array> = {
    [PROJECT_PACKAGE_META_PATH]: encodeProjectJson(meta),
    [PROJECT_MANIFEST_PATH]: encodeProjectJson(exportable),
  };

  for (const layer of memo.layers) {
    if (layer.duration <= 0) {
      continue;
    }
    const source = requireLayerFile(memo.id, layer.fileName);
    if (!source.exists) {
      throw new Error(`Missing audio file for “${layer.label || layer.fileName}”.`);
    }
    const bytes = await source.bytes();
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`Empty audio file for “${layer.label || layer.fileName}”.`);
    }
    archiveFiles[packagedMediaPath(layer.fileName)] = bytes;
  }

  const zipped = zipProjectFiles(archiveFiles);
  const baseName = sanitizeExportFileName(memo.title);
  const output = new File(Paths.cache, `${baseName}.vmp`);
  if (output.exists) {
    output.delete();
  }
  output.create();
  output.write(zipped);
  return output;
}

/** Parse and validate a project file URI into remappable contents. */
export async function readProjectArchiveFromUri(
  uri: string
): Promise<ValidatedProjectArchive> {
  const source = new File(uri);
  if (!source.exists) {
    throw new Error('Selected file could not be read.');
  }

  const bytes = await source.bytes();
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipProjectFiles(bytes);
  } catch {
    throw new Error('This file is not a valid project archive.');
  }

  return validateProjectArchive(archive);
}
