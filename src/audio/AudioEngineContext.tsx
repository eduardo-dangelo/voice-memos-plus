import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import { memoAudioEngine, type EngineState, type MemoAudioEngine } from './MemoAudioEngine';

const AudioEngineContext = createContext<MemoAudioEngine>(memoAudioEngine);

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  return (
    <AudioEngineContext.Provider value={memoAudioEngine}>{children}</AudioEngineContext.Provider>
  );
}

export function useAudioEngine(): MemoAudioEngine {
  return useContext(AudioEngineContext);
}

export function useAudioEngineState(): EngineState {
  const engine = useAudioEngine();
  return useSyncExternalStore(engine.subscribe.bind(engine), engine.getState.bind(engine));
}
