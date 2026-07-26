import { useKeepAwake } from 'expo-keep-awake';

import { useAudioEngineSelector } from './AudioEngineContext';

const KEEP_AWAKE_TAG = 'recording';

function KeepAwakeActive() {
  useKeepAwake(KEEP_AWAKE_TAG);
  return null;
}

/** Prevents screen sleep while the audio engine is recording. */
export function KeepAwakeWhileRecording() {
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  return isRecording ? <KeepAwakeActive /> : null;
}
