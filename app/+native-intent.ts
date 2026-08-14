import { rewriteIncomingProjectPath } from '@/src/storage/projectOpenUrl';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return rewriteIncomingProjectPath(path);
  } catch {
    return path;
  }
}
