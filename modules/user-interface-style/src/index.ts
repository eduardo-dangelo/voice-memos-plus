import { requireNativeViewManager } from 'expo-modules-core';
import { createElement, type ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';

export type UserInterfaceStyleViewProps = ViewProps & {
  colorScheme?: 'light' | 'dark' | null;
};

type NativeProps = UserInterfaceStyleViewProps;

let NativeView: ComponentType<NativeProps> | null = null;

try {
  NativeView = requireNativeViewManager<NativeProps>(
    'UserInterfaceStyle',
    'UserInterfaceStyleView'
  );
} catch {
  NativeView = null;
}

/**
 * Transparent UIView wrapper that sets `overrideUserInterfaceStyle`.
 * Used so native UIMenu chrome follows the app theme inside form sheets.
 * Falls back to a plain View before the native module is linked.
 */
export function UserInterfaceStyleView({
  colorScheme,
  ...props
}: UserInterfaceStyleViewProps) {
  if (!NativeView) {
    return createElement(View, props);
  }
  return createElement(NativeView, { colorScheme, ...props });
}
