import { requireNativeModule } from 'expo-modules-core';
import { useEffect, useState } from 'react';

export type HorizontalSizeClass = 'compact' | 'regular' | 'unspecified';

type HorizontalSizeClassModule = {
  getHorizontalSizeClass: () => HorizontalSizeClass;
  addListener: (
    eventName: 'onChange',
    listener: (event: { horizontalSizeClass: HorizontalSizeClass }) => void
  ) => { remove: () => void };
};

let nativeModule: HorizontalSizeClassModule | null = null;

try {
  nativeModule = requireNativeModule<HorizontalSizeClassModule>('HorizontalSizeClass');
} catch {
  nativeModule = null;
}

function readHorizontalSizeClass(): HorizontalSizeClass {
  try {
    return nativeModule?.getHorizontalSizeClass() ?? 'unspecified';
  } catch {
    return 'unspecified';
  }
}

/** Phone compact is closed. Phone regular is the open Duo. iPad is unchanged. */
export function useHorizontalSizeClass(): HorizontalSizeClass {
  const [sizeClass, setSizeClass] = useState(readHorizontalSizeClass);

  useEffect(() => {
    const subscription = nativeModule?.addListener('onChange', (event) => {
      setSizeClass(event.horizontalSizeClass);
    });
    setSizeClass(readHorizontalSizeClass());
    return () => subscription?.remove();
  }, []);

  return sizeClass;
}
