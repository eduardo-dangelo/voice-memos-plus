/** Fraction of full charge that triggers the low-battery warning. */
export const LOW_BATTERY_THRESHOLD = 0.1;

/**
 * Mirrors expo-battery `BatteryState` numeric values so helpers stay testable
 * without importing the native module.
 */
export const BatteryPlugState = {
  UNKNOWN: 0,
  UNPLUGGED: 1,
  CHARGING: 2,
  FULL: 3,
  NOT_CHARGING: 4,
} as const;

export type LowBatteryWarningInput = {
  level: number;
  batteryState: number;
  dismissedWhileBelow: boolean;
};

/** True when level is known and strictly below the threshold. */
export function isBatteryLow(level: number): boolean {
  return level >= 0 && level < LOW_BATTERY_THRESHOLD;
}

/** True when the device is charging or reported full (plugged in). */
export function isPluggedIn(batteryState: number): boolean {
  return (
    batteryState === BatteryPlugState.CHARGING ||
    batteryState === BatteryPlugState.FULL
  );
}

/**
 * Whether the low-battery dialog should be presented.
 * Unknown level (`-1`) and plugged-in states never warn.
 */
export function shouldShowLowBatteryWarning({
  level,
  batteryState,
  dismissedWhileBelow,
}: LowBatteryWarningInput): boolean {
  if (!isBatteryLow(level)) {
    return false;
  }
  if (isPluggedIn(batteryState)) {
    return false;
  }
  if (dismissedWhileBelow) {
    return false;
  }
  return true;
}

/**
 * Clear dismissal hysteresis once level recovers to the threshold or above.
 * Unknown levels leave the dismissed flag unchanged.
 */
export function nextDismissedWhileBelow(
  level: number,
  dismissedWhileBelow: boolean
): boolean {
  if (level >= LOW_BATTERY_THRESHOLD) {
    return false;
  }
  return dismissedWhileBelow;
}
