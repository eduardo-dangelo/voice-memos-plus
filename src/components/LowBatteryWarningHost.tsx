import * as Battery from 'expo-battery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAudioEngineSelector } from '@/src/audio/AudioEngineContext';
import {
  nextDismissedWhileBelow,
  shouldShowLowBatteryWarning,
} from '@/src/battery/lowBatteryWarning';
import { RecordingPromptDialog } from '@/src/components/RecordingPromptDialog';

const LOW_BATTERY_MESSAGE =
  'Battery is below 10%. Performance may be reduced, and long recordings could be interrupted.';

/**
 * Global host: warns when battery drops below 10% on any screen.
 * Suppresses while recording to avoid fighting precount/record Modals.
 */
export function LowBatteryWarningHost() {
  const isRecording = useAudioEngineSelector((state) => state.isRecording);
  const [visible, setVisible] = useState(false);

  const levelRef = useRef<number | null>(null);
  const batteryStateRef = useRef<Battery.BatteryState | null>(null);
  const dismissedWhileBelowRef = useRef(false);
  const readyRef = useRef(false);
  const pendingWhileRecordingRef = useRef(false);
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  const evaluate = useCallback(() => {
    if (!readyRef.current) {
      return;
    }
    const level = levelRef.current;
    const batteryState = batteryStateRef.current;
    if (level == null || batteryState == null) {
      return;
    }

    dismissedWhileBelowRef.current = nextDismissedWhileBelow(
      level,
      dismissedWhileBelowRef.current
    );

    const shouldShow = shouldShowLowBatteryWarning({
      level,
      batteryState,
      dismissedWhileBelow: dismissedWhileBelowRef.current,
    });

    if (!shouldShow) {
      pendingWhileRecordingRef.current = false;
      setVisible(false);
      return;
    }

    if (isRecordingRef.current) {
      pendingWhileRecordingRef.current = true;
      setVisible(false);
      return;
    }

    pendingWhileRecordingRef.current = false;
    setVisible(true);
  }, []);

  const refreshPowerState = useCallback(async () => {
    try {
      const available = await Battery.isAvailableAsync();
      if (!available) {
        readyRef.current = false;
        setVisible(false);
        return;
      }
      const power = await Battery.getPowerStateAsync();
      levelRef.current = power.batteryLevel;
      batteryStateRef.current = power.batteryState;
      readyRef.current = true;
      evaluate();
    } catch {
      // Battery API unavailable — stay silent.
      readyRef.current = false;
      setVisible(false);
    }
  }, [evaluate]);

  useEffect(() => {
    void refreshPowerState();

    const levelSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      levelRef.current = batteryLevel;
      if (readyRef.current) {
        evaluate();
      }
    });
    const stateSub = Battery.addBatteryStateListener(({ batteryState }) => {
      batteryStateRef.current = batteryState;
      if (readyRef.current) {
        evaluate();
      }
    });
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refreshPowerState();
      }
    });

    return () => {
      levelSub.remove();
      stateSub.remove();
      appSub.remove();
    };
  }, [evaluate, refreshPowerState]);

  useEffect(() => {
    if (!isRecording && pendingWhileRecordingRef.current) {
      evaluate();
    }
  }, [isRecording, evaluate]);

  const handleDismiss = useCallback(() => {
    dismissedWhileBelowRef.current = true;
    pendingWhileRecordingRef.current = false;
    setVisible(false);
  }, []);

  return (
    <RecordingPromptDialog
      visible={visible}
      title="Low battery"
      heroIcon="battery.25"
      message={LOW_BATTERY_MESSAGE}
      actions="ok"
      onDismiss={handleDismiss}
    />
  );
}
