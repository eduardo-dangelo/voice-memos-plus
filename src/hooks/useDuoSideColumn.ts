import { useHorizontalSizeClass } from 'horizontal-size-class';
import { useMemo } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FloatingHeaderIcon } from '@/src/components/FloatingHeaderButton';

/**
 * The closed iPhone Duo side column is about 84pt. Smaller horizontal
 * insets are a normal safe area, including portrait iPhone (0).
 */
const SIDE_COLUMN_MIN_INSET = 60;

function isIphone(): boolean {
  return Platform.OS === 'ios' && !Platform.isPad;
}

export type DuoSideColumn = {
  active: boolean;
  edge: 'left' | 'right' | null;
  inset: number;
};

const INACTIVE_SIDE_COLUMN: DuoSideColumn = { active: false, edge: null, inset: 0 };

export function useDuoSideColumn(): DuoSideColumn {
  const { left, right } = useSafeAreaInsets();
  const horizontalSizeClass = useHorizontalSizeClass();

  return useMemo(() => {
    if (!isIphone()) {
      return INACTIVE_SIDE_COLUMN;
    }
    if (left >= SIDE_COLUMN_MIN_INSET && left >= right) {
      return { active: true, edge: 'left' as const, inset: left };
    }
    if (right >= SIDE_COLUMN_MIN_INSET) {
      return { active: true, edge: 'right' as const, inset: right };
    }
    if (horizontalSizeClass === 'regular') {
      return { active: true, edge: null, inset: 0 };
    }
    return INACTIVE_SIDE_COLUMN;
  }, [horizontalSizeClass, left, right]);
}

/** Native symbol button. UIKit places icon items in the Duo side column. */
export function sideColumnIconItem(options: {
  label: string;
  icon: FloatingHeaderIcon;
  onPress: () => void;
  tintColor: ColorValue;
  disabled?: boolean;
}) {
  return {
    type: 'button' as const,
    label: options.label,
    accessibilityLabel: options.label,
    icon: { type: 'sfSymbol' as const, name: options.icon },
    onPress: options.onPress,
    tintColor: options.tintColor,
    disabled: options.disabled,
    hidesSharedBackground: true,
    sharesBackground: false,
  };
}
