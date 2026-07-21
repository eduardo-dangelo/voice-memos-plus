import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';
import { widgetsDirectory } from 'expo-widgets';

import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';
import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import {
  addStackedLayer,
  getMemo,
  replaceLayerSegment,
  saveRecording,
} from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';
import { getReplaceSpliceParams } from '@/src/storage/types';

export type RecordingSessionMode = 'new' | 'stack' | 'replace';

export type ActiveRecordingSession = {
  memoId: string;
  memoTitle?: string;
  mode: RecordingSessionMode;
  layerId: string | null;
  startTime: number;
  trackColor: string | null;
  recordingStartedAt?: number;
};

export type RecordingSaveResult = {
  memo: Memo;
  activeLayerId: string | null;
  seekTime: number;
  wasStackMode: boolean;
  wasReplaceMode: boolean;
};

type SaveListener = (result: RecordingSaveResult) => void;

const SESSION_FILENAME = 'recording-session.json';

let session: ActiveRecordingSession | null = null;
let saveInFlight: Promise<RecordingSaveResult | null> | null = null;
const listeners = new Set<SaveListener>();

function getSessionFileUri(): string | null {
  if (!widgetsDirectory) {
    return null;
  }
  return `${widgetsDirectory}/${SESSION_FILENAME}`;
}

async function persistSessionToStorage(next: ActiveRecordingSession): Promise<void> {
  const uri = getSessionFileUri();
  if (!uri) {
    return;
  }

  try {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(next));
  } catch (error) {
    if (__DEV__) {
      console.warn('[activeRecordingSession] persist failed', error);
    }
  }
}

async function deletePersistedSession(): Promise<void> {
  const uri = getSessionFileUri();
  if (!uri) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[activeRecordingSession] delete persisted session failed', error);
    }
  }
}

export function beginSession(next: ActiveRecordingSession): void {
  session = next;
  void persistSessionToStorage(next);
}

export function clearSession(): void {
  session = null;
  void deletePersistedSession();
}

export function getSession(): ActiveRecordingSession | null {
  return session;
}

export async function hydrateSessionFromStorage(): Promise<ActiveRecordingSession | null> {
  if (session) {
    return session;
  }

  const uri = getSessionFileUri();
  if (!uri) {
    return null;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }

    const raw = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(raw) as ActiveRecordingSession;
    session = parsed;
    return parsed;
  } catch (error) {
    if (__DEV__) {
      console.warn('[activeRecordingSession] hydrate failed', error);
    }
    return null;
  }
}

export function subscribeRecordingSave(listener: SaveListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(result: RecordingSaveResult): void {
  for (const listener of listeners) {
    listener(result);
  }
}

async function ensureSessionForStop(): Promise<ActiveRecordingSession> {
  if (session) {
    return session;
  }

  await hydrateSessionFromStorage();
  if (session) {
    return session;
  }

  throw new Error('Recording session could not be restored');
}

export async function stopAndSave(
  engine: MemoAudioEngine,
  options?: { reloadEngine?: boolean }
): Promise<RecordingSaveResult | null> {
  if (saveInFlight) {
    return saveInFlight;
  }

  if (!engine.getState().isRecording) {
    return null;
  }

  const reloadEngine = options?.reloadEngine !== false;

  const savePromise = (async (): Promise<RecordingSaveResult | null> => {
    try {
      const isBackground = AppState.currentState !== 'active';

      const capture = await engine.stopRecorderCapture();
      const currentSession = getSession() ?? (await ensureSessionForStop());
      const currentMemo = await getMemo(currentSession.memoId);
      if (!currentMemo) {
        throw new Error('Memo not found');
      }

      const { path, duration, peaks } = await engine.finalizeRecordingAfterStop(capture, {
        deferPlaybackSetup: isBackground,
      });

      if (!isBackground) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      const wasStackMode = currentSession.mode === 'stack';
      const wasReplaceMode = currentSession.mode === 'replace';
      const capturedStartTime = currentSession.startTime;
      const layerId = currentSession.layerId;

      let updated: Memo;
      let activeLayerId: string | null = layerId;

      const softwareCue = capture.wasSoftwareMonitoredCue;

      if (wasStackMode) {
        updated = await addStackedLayer(
          currentMemo.id,
          capturedStartTime,
          path,
          peaks,
          currentSession.trackColor ?? undefined,
          { softwareCue }
        );
        activeLayerId = updated.layers[updated.layers.length - 1]?.id ?? layerId;
      } else if (wasReplaceMode) {
        if (!layerId) {
          throw new Error('No track selected');
        }
        const replaceLayer = currentMemo.layers.find((layer) => layer.id === layerId);
        if (!replaceLayer || replaceLayer.duration <= 0) {
          throw new Error('No active layer');
        }
        const { trimStart: fileTrimStart, trimEnd: fileTrimEnd, leadingPadSeconds } =
          getReplaceSpliceParams(replaceLayer, capturedStartTime, duration);
        updated = await replaceLayerSegment(
          currentMemo.id,
          replaceLayer.id,
          fileTrimStart,
          fileTrimEnd,
          path,
          peaks,
          leadingPadSeconds,
          { softwareCue }
        );
      } else {
        updated = await saveRecording(currentMemo.id, path, duration, peaks, {
          softwareCue,
        });
        activeLayerId = updated.layers[0]?.id ?? null;
      }

      const result: RecordingSaveResult = {
        memo: updated,
        activeLayerId,
        seekTime: wasStackMode || wasReplaceMode ? capturedStartTime : 0,
        wasStackMode,
        wasReplaceMode,
      };

      clearSession();

      if (isBackground) {
        engine.scheduleDeferredEngineReload(updated, result.seekTime);
      } else if (reloadEngine) {
        await loadMemoIntoEngine(engine, updated, result.seekTime);
      }

      notifyListeners(result);
      return result;
    } catch (error) {
      if (__DEV__) {
        console.warn('[activeRecordingSession] stopAndSave failed', error);
      }
      throw error;
    }
  })();

  saveInFlight = savePromise;
  try {
    return await savePromise;
  } finally {
    if (saveInFlight === savePromise) {
      saveInFlight = null;
    }
  }
}

export async function awaitSaveInFlight(): Promise<RecordingSaveResult | null | void> {
  if (!saveInFlight) {
    return;
  }
  return saveInFlight;
}
