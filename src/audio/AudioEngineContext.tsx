import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

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

/**
 * Subscribe to a slice of engine state. Re-renders only when the selected value
 * changes per `isEqual` (defaults to Object.is).
 */
export function useAudioEngineSelector<T>(
  selector: (state: EngineState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const engine = useAudioEngine();
  const selectorRef = useRef(selector);
  const isEqualRef = useRef(isEqual);
  selectorRef.current = selector;
  isEqualRef.current = isEqual;

  const cacheRef = useRef<{ state: EngineState; selected: T } | null>(null);

  const getSelection = useCallback(() => {
    const state = engine.getState();
    const cached = cacheRef.current;
    const nextSelected = selectorRef.current(state);
    if (cached && isEqualRef.current(cached.selected, nextSelected)) {
      cacheRef.current = { state, selected: cached.selected };
      return cached.selected;
    }
    cacheRef.current = { state, selected: nextSelected };
    return nextSelected;
  }, [engine]);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      engine.subscribe(() => {
        onStoreChange();
      }),
    [engine]
  );

  return useSyncExternalStore(subscribe, getSelection, getSelection);
}
