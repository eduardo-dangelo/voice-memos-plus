import { getFoldersFile } from '@/src/storage/paths';
import type { Folder } from '@/src/storage/types';
import { randomId } from '@/src/utils/id';

function readFolders(): Folder[] {
  const file = getFoldersFile();
  try {
    const parsed = JSON.parse(file.textSync()) as Folder[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => a.order - b.order) : [];
  } catch {
    return [];
  }
}

function writeFolders(folders: Folder[]): void {
  const file = getFoldersFile();
  file.write(JSON.stringify(folders, null, 2));
}

export async function listFolders(): Promise<Folder[]> {
  return readFolders();
}

export async function getFolder(folderId: string): Promise<Folder | null> {
  return readFolders().find((folder) => folder.id === folderId) ?? null;
}

export async function createFolder(name: string): Promise<Folder> {
  const folders = readFolders();
  const folder: Folder = {
    id: randomId(),
    name: name.trim() || 'New Folder',
    createdAt: new Date().toISOString(),
    order: folders.length,
  };
  folders.push(folder);
  writeFolders(folders);
  return folder;
}

export async function renameFolder(folderId: string, name: string): Promise<Folder> {
  const folders = readFolders();
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) {
    throw new Error('Folder not found');
  }
  folder.name = name.trim() || folder.name;
  writeFolders(folders);
  return folder;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const folders = readFolders().filter((entry) => entry.id !== folderId);
  const reordered = folders.map((folder, index) => ({ ...folder, order: index }));
  writeFolders(reordered);
  const { listAllActiveMemos, moveMemoToFolder } = await import('@/src/storage/memoStore');
  const memos = await listAllActiveMemos();
  await Promise.all(
    memos
      .filter((memo) => memo.folderId === folderId)
      .map((memo) => moveMemoToFolder(memo.id, null))
  );
}

export async function reorderFolders(orderedIds: string[]): Promise<Folder[]> {
  const folders = readFolders();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const next: Folder[] = [];

  orderedIds.forEach((id, index) => {
    const folder = byId.get(id);
    if (folder) {
      next.push({ ...folder, order: index });
      byId.delete(id);
    }
  });

  const remaining = [...byId.values()].sort((a, b) => a.order - b.order);
  remaining.forEach((folder, offset) => {
    next.push({ ...folder, order: orderedIds.length + offset });
  });

  writeFolders(next);
  return next;
}
