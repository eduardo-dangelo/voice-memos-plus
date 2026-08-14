import { isProjectFileName } from './memoPackageFormat';

function fileNameFromPathname(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Normalize a system open-URL into a `file://` URI when it points at a `.vmp` project. */
export function projectFileUrlFromOpenPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^file:/i.test(trimmed)) {
      const url = new URL(trimmed);
      if (isProjectFileName(fileNameFromPathname(url.pathname))) {
        return url.href;
      }
      return null;
    }
  } catch {
    // Fall through to bare-path handling.
  }

  const withoutQuery = trimmed.split('?')[0]?.split('#')[0] ?? trimmed;
  if (!isProjectFileName(fileNameFromPathname(withoutQuery))) {
    return null;
  }

  if (withoutQuery.startsWith('/')) {
    return `file://${withoutQuery}`;
  }

  return withoutQuery;
}

/**
 * Rewrite a native open-with URL into an in-app import route.
 * Unrelated URLs are returned unchanged so Expo Router deep links still work.
 */
export function rewriteIncomingProjectPath(path: string): string {
  try {
    if (path.startsWith('/import-project')) {
      return path;
    }
    const fileUrl = projectFileUrlFromOpenPath(path);
    if (!fileUrl) {
      return path;
    }
    return `/import-project?uri=${encodeURIComponent(fileUrl)}`;
  } catch {
    return path;
  }
}
