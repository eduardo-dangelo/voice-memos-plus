import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';

import { loadMemoIntoEngine } from '@/src/audio/loadMemoIntoEngine';
import type { MemoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { getRecordingLatencySkipSeconds } from '@/src/audio/recordingLatency';
import { notifyLibraryChanged } from '@/src/recording/memoUpdateEvents';
import {
  addStackedLayer,
  alignStackedLayer,
  deleteMemo,
  ensureWaveformPeaks,
  getMemo,
  replaceLayerSegment,
  saveRecording,
} from '@/src/storage/memoStore';
import type { Memo } from '@/src/storage/types';
import {
  getReplaceSpliceParams,
  MIN_REPLACE_EFFECTIVE_DURATION_SEC,
} from '@/src/storage/types';

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
  engineReloaded: boolean;
};

export type RecordingSavePhase =
  | 'processing'
  | 'saving'
  | 'aligning'
  | 'finalizing';

export type DiscardUnfinishedResult = {
  memoId: string;
  mode: RecordingSessionMode;
  deletedMemo: boolean;
};

type SaveListener = (result: RecordingSaveResult) => void;
type SaveProgressListener = (phase: RecordingSavePhase) => void;

const SESSION_FILENAME = 'recording-session.json';

let session: ActiveRecordingSession | null = null;
let saveInFlight: Promise<RecordingSaveResult | null> | null = null;
let discardInFlight: Promise<DiscardUnfinishedResult | null> | null = null;
/** Memo id deleted by the most recent cold-start discard (new take). */
let lastDiscardedMemoId: string | null = null;
const listeners = new Set<SaveListener>();
const progressListeners = new Set<SaveProgressListener>();

function getSessionFile(): File {
  return new File(Paths.document, SESSION_FILENAME);
}

function persistSessionToStorage(next: ActiveRecordingSession): void {
  const file = getSessionFile();
  try {
    if (!file.exists) {
      file.create();
    }
    file.write(JSON.stringify(next));
  } catch (error) {
    if (__DEV__) {
      console.warn('[activeRecordingSession] persist failed', error);
    }
  }
}

function deletePersistedSession(): void {
  const file = getSessionFile();
  try {
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[activeRecordingSession] delete persisted session failed', error);
    }
  }
}

export function beginSession(next: ActiveRecordingSession): void {
  session = next;
  persistSessionToStorage(session);
}

export function clearSession(): void {
  session = null;
  deletePersistedSession();
}

export function getSession(): ActiveRecordingSession | null {
  return session;
}

export function getLastDiscardedMemoId(): string | null {
  return lastDiscardedMemoId;
}

export async function hydrateSessionFromStorage(): Promise<ActiveRecordingSession | null> {
  if (session) {
    return session;
  }

  const file = getSessionFile();
  try {
    if (!file.exists) {
      return null;
    }

    const raw = new TextDecoder().decode(file.bytesSync());
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

export function subscribeRecordingSaveProgress(
  listener: SaveProgressListener
): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function notifyListeners(result: RecordingSaveResult): void {
  for (const listener of listeners) {
    listener(result);
  }
}

function notifySaveProgress(phase: RecordingSavePhase): void {
  for (const listener of progressListeners) {
    listener(phase);
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

/**
 * After process death, discard any unfinished take.
 * - new: delete the memo shell
 * - stack/replace: drop session only; prior layers stay
 */
export async function discardUnfinishedRecording(
  engine: MemoAudioEngine
): Promise<DiscardUnfinishedResult | null> {
  if (discardInFlight) {
    return discardInFlight;
  }

  if (engine.getState().isRecording) {
    return null;
  }

  await hydrateSessionFromStorage();
  const currentSession = getSession();
  if (!currentSession) {
    return null;
  }

  const discardPromise = (async (): Promise<DiscardUnfinishedResult | null> => {
    const memoId = currentSession.memoId;
    const mode = currentSession.mode;
    let deletedMemo = false;

    try {
      if (mode === 'new') {
        await deleteMemo(memoId);
        deletedMemo = true;
        lastDiscardedMemoId = memoId;
        notifyLibraryChanged({ reason: 'discardedNewRecording', memoId });
      }

      clearSession();

      if (engine.getState().memoId === memoId) {
        try {
          engine.unload();
        } catch (error) {
          if (__DEV__) {
            console.warn('[activeRecordingSession] discard unload failed', error);
          }
        }
      }

      return { memoId, mode, deletedMemo };
    } catch (error) {
      if (__DEV__) {
        console.warn('[activeRecordingSession] discardUnfinishedRecording failed', error);
      }
      clearSession();
      return { memoId, mode, deletedMemo };
    }
  })();

  discardInFlight = discardPromise;
  try {
    return await discardPromise;
  } finally {
    if (discardInFlight === discardPromise) {
      discardInFlight = null;
    }
  }
}

export type StopAndSaveOptions = {
  reloadEngine?: boolean;
  /**
   * Called right after recorder capture stops (before finalize / persist).
   * Use to exit recording UI while save continues.
   */
  onCaptureComplete?: () => void;
};

/**
 * Stop capture, persist the take, and reload the engine.
 * Always defers playback-session restore until after file persist so
 * `onCaptureComplete` can exit recording layout without waiting on graph reset
 * or stack PCM alignment. Stack path notifies after coarse persist, then
 * awaits fine-align + peak reconcile (final notify) before graph restore —
 * still inside `saveInFlight` so the next record waits.
 */
export async function stopAndSave(
  engine: MemoAudioEngine,
  options?: StopAndSaveOptions
): Promise<RecordingSaveResult | null> {
  if (saveInFlight) {
    return saveInFlight;
  }

  if (!engine.getState().isRecording) {
    return null;
  }

  const savePromise = (async (): Promise<RecordingSaveResult | null> => {
    try {
      const isBackground = AppState.currentState !== 'active';

      const capture = await engine.stopRecorderCapture();
      // Exit recording layout before finalize/PCM align/graph restore.
      options?.onCaptureComplete?.();

      const currentSession = getSession() ?? (await ensureSessionForStop());
      const currentMemo = await getMemo(currentSession.memoId);
      if (!currentMemo) {
        throw new Error('Memo not found');
      }

      const wasStackMode = currentSession.mode === 'stack';
      const wasReplaceMode = currentSession.mode === 'replace';
      const shouldReloadEngine =
        (options?.reloadEngine !== false) || wasStackMode || wasReplaceMode;

      notifySaveProgress('processing');
      // Always defer AVAudioSession/graph restore past UI exit + file persist.
      const { path, duration, peaks } = await engine.finalizeRecordingAfterStop(capture, {
        deferPlaybackSetup: true,
      });

      if (!isBackground) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      const capturedStartTime = currentSession.startTime;
      const layerId = currentSession.layerId;

      let updated: Memo;
      let activeLayerId: string | null = layerId;
      let replaceLayerPath: string | undefined;

      const softwareCue = capture.wasSoftwareMonitoredCue;
      const cueRoute = capture.cueOutputRoute;
      const monitorPath = capture.monitorPath;
      const measuredCueLeadSec = capture.measuredCueLeadSec;
      const latencyOptions = {
        softwareCue: softwareCue === true,
        cueRoute,
        monitorPath,
        measuredCueLeadSec,
      };
      // Single skip value for replace hole + PCM — never re-derive separately.
      const replacementSkipSeconds = getRecordingLatencySkipSeconds(latencyOptions);

      notifySaveProgress('saving');
      if (wasStackMode) {
        updated = await addStackedLayer(
          currentMemo.id,
          capturedStartTime,
          path,
          peaks,
          currentSession.trackColor ?? undefined,
          { ...latencyOptions, duration }
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
          getReplaceSpliceParams(
            replaceLayer,
            capturedStartTime,
            duration,
            replacementSkipSeconds
          );
        if (
          leadingPadSeconds <= 0 &&
          fileTrimEnd - fileTrimStart < MIN_REPLACE_EFFECTIVE_DURATION_SEC
        ) {
          throw new Error('Replacement too short');
        }
        // Full-file peaks come from splice PCM inside replaceLayerSegment.
        const replaceResult = await replaceLayerSegment(
          currentMemo.id,
          replaceLayer.id,
          fileTrimStart,
          fileTrimEnd,
          path,
          leadingPadSeconds,
          { ...latencyOptions, replacementSkipSeconds }
        );
        updated = replaceResult.memo;
        replaceLayerPath = replaceResult.prime?.path;
      } else {
        updated = await saveRecording(currentMemo.id, path, duration, peaks, latencyOptions);
        activeLayerId = updated.layers[0]?.id ?? null;
      }

      const willReloadEngineNow = !isBackground && shouldReloadEngine;
      const result: RecordingSaveResult = {
        memo: updated,
        activeLayerId,
        seekTime: wasStackMode || wasReplaceMode ? capturedStartTime : 0,
        wasStackMode,
        wasReplaceMode,
        // Mark true when this path owns the reload so subscribeRecordingSave
        // does not race a second loadMemoIntoEngine.
        engineReloaded: willReloadEngineNow,
      };

      clearSession();

      if (wasStackMode) {
        // Show the new layer immediately (before PCM align / peak reconcile).
        notifyListeners(result);

        // Fine-align after first paint so stop lag is not blocked on XCorr.
        if (softwareCue === true && activeLayerId) {
          notifySaveProgress('aligning');
          const aligned = await alignStackedLayer(updated.id, activeLayerId);
          if (aligned) {
            updated = aligned;
          }
        }

        // Same peak/duration reconcile as loadMemo — fixes stretched live peaks
        // without requiring close/reopen.
        notifySaveProgress('finalizing');
        updated = await ensureWaveformPeaks(updated, {
          onlyLayerIds: activeLayerId ? [activeLayerId] : undefined,
        });
        result.memo = updated;
        notifyListeners(result);
      } else {
        // First take / replace: reconcile before the single notify so Track 1
        // cannot ship stretched live peaks (same invariant as reopen).
        notifySaveProgress('finalizing');
        updated = await ensureWaveformPeaks(updated, {
          onlyLayerIds: activeLayerId ? [activeLayerId] : undefined,
        });
        result.memo = updated;
        notifyListeners(result);
      }

      if (isBackground) {
        engine.scheduleDeferredEngineReload(
          updated,
          result.seekTime,
          replaceLayerPath ? [replaceLayerPath] : undefined
        );
      } else {
        await engine.finishDeferredPlaybackSetup();
        if (shouldReloadEngine) {
          if (replaceLayerPath) {
            engine.invalidateLayerBuffer(replaceLayerPath);
          }
          // Do not createBufferFromSamples/prime here — that reopens a playback
          // AudioContext and leaves the next replace arm fighting a dirty session.
          // Next play/arm decodes from the updated file after invalidate.
          await loadMemoIntoEngine(engine, updated, result.seekTime);
        }
      }

      return result;
    } catch (error) {
      if (__DEV__) {
        console.warn('[activeRecordingSession] stopAndSave failed', error);
      }
      // Ensure deferred playback setup is not left hanging after a failed save.
      try {
        await engine.finishDeferredPlaybackSetup();
      } catch {
        // Best-effort restore.
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
