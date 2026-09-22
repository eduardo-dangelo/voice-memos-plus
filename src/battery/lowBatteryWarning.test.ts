import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BatteryPlugState,
  isBatteryLow,
  isPluggedIn,
  LOW_BATTERY_THRESHOLD,
  nextDismissedWhileBelow,
  shouldShowLowBatteryWarning,
} from './lowBatteryWarning';

test('isBatteryLow is true strictly below threshold', () => {
  assert.equal(isBatteryLow(0), true);
  assert.equal(isBatteryLow(0.099), true);
  assert.equal(isBatteryLow(LOW_BATTERY_THRESHOLD), false);
  assert.equal(isBatteryLow(0.5), false);
});

test('isBatteryLow is false for unknown level', () => {
  assert.equal(isBatteryLow(-1), false);
});

test('isPluggedIn is true for charging and full only', () => {
  assert.equal(isPluggedIn(BatteryPlugState.CHARGING), true);
  assert.equal(isPluggedIn(BatteryPlugState.FULL), true);
  assert.equal(isPluggedIn(BatteryPlugState.UNPLUGGED), false);
  assert.equal(isPluggedIn(BatteryPlugState.UNKNOWN), false);
  assert.equal(isPluggedIn(BatteryPlugState.NOT_CHARGING), false);
});

test('shouldShowLowBatteryWarning requires low, unplugged, not dismissed', () => {
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.05,
      batteryState: BatteryPlugState.UNPLUGGED,
      dismissedWhileBelow: false,
    }),
    true
  );
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.05,
      batteryState: BatteryPlugState.UNKNOWN,
      dismissedWhileBelow: false,
    }),
    true
  );
});

test('shouldShowLowBatteryWarning is false when charging or full', () => {
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.05,
      batteryState: BatteryPlugState.CHARGING,
      dismissedWhileBelow: false,
    }),
    false
  );
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.05,
      batteryState: BatteryPlugState.FULL,
      dismissedWhileBelow: false,
    }),
    false
  );
});

test('shouldShowLowBatteryWarning is false when dismissed while still below', () => {
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.05,
      batteryState: BatteryPlugState.UNPLUGGED,
      dismissedWhileBelow: true,
    }),
    false
  );
});

test('shouldShowLowBatteryWarning is false when level is unknown or recovered', () => {
  assert.equal(
    shouldShowLowBatteryWarning({
      level: -1,
      batteryState: BatteryPlugState.UNPLUGGED,
      dismissedWhileBelow: false,
    }),
    false
  );
  assert.equal(
    shouldShowLowBatteryWarning({
      level: 0.2,
      batteryState: BatteryPlugState.UNPLUGGED,
      dismissedWhileBelow: false,
    }),
    false
  );
});

test('nextDismissedWhileBelow clears when level recovers', () => {
  assert.equal(nextDismissedWhileBelow(0.15, true), false);
  assert.equal(nextDismissedWhileBelow(LOW_BATTERY_THRESHOLD, true), false);
});

test('nextDismissedWhileBelow keeps dismissal while still below or unknown', () => {
  assert.equal(nextDismissedWhileBelow(0.05, true), true);
  assert.equal(nextDismissedWhileBelow(0.05, false), false);
  assert.equal(nextDismissedWhileBelow(-1, true), true);
});
