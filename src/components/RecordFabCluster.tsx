import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { isHeadphonesConnected } from '@/src/audio/headphoneDetection';
import { MetronomeButton } from '@/src/components/MetronomeButton';
import { MetronomeSettingsSheet } from '@/src/components/MetronomeSettingsSheet';
import { PrecountButton } from '@/src/components/PrecountButton';
import { RecordButton } from '@/src/components/RecordButton';
import {
  getRecordingDefaultsSync,
  setRecordingDefaults,
} from '@/src/settings/appSettings';
import {
  DEFAULT_METRONOME_SETTINGS,
  nextPrecountMode,
  type MetronomeSettings,
  type PrecountMode,
} from '@/src/storage/types';

const METRONOME_HEADPHONES_TITLE = 'Connect headphones';
const METRONOME_HEADPHONES_MESSAGE =
  'You need headphones to use the metronome while recording.';

export type RecordFabSettings = {
  precount: PrecountMode;
  metronome: MetronomeSettings;
};

type Props = {
  disabled?: boolean;
  bottomOffset?: number;
  onRecord: (settings: RecordFabSettings) => void;
};

function metronomeFromDefaults(): MetronomeSettings {
  const defaults = getRecordingDefaultsSync();
  return {
    ...DEFAULT_METRONOME_SETTINGS,
    enabled: defaults.metronomeEnabled,
    bpm: defaults.bpm,
    showGrid: defaults.metronomeEnabled,
  };
}

function persistSettings(precount: PrecountMode, metronome: MetronomeSettings) {
  void setRecordingDefaults({
    precount,
    metronomeEnabled: metronome.enabled,
    bpm: metronome.bpm,
  });
}

export function RecordFabCluster({ disabled, bottomOffset = 32, onRecord }: Props) {
  const styles = useStyles();
  const [precount, setPrecount] = useState<PrecountMode>(
    () => getRecordingDefaultsSync().precount
  );
  const [metronome, setMetronome] = useState<MetronomeSettings>(metronomeFromDefaults);
  const [metronomeSettingsVisible, setMetronomeSettingsVisible] = useState(false);

  useEffect(() => {
    if (disabled) {
      setMetronomeSettingsVisible(false);
    }
  }, [disabled]);

  const handlePrecountCycle = () => {
    setPrecount((current) => {
      const next = nextPrecountMode(current);
      persistSettings(next, metronome);
      return next;
    });
  };

  const handleMetronomeToggle = () => {
    void (async () => {
      const enabling = !metronome.enabled;
      if (enabling && !(await isHeadphonesConnected())) {
        Alert.alert(METRONOME_HEADPHONES_TITLE, METRONOME_HEADPHONES_MESSAGE);
        return;
      }
      setMetronome((current) => {
        const enabled = !current.enabled;
        const next = { ...current, enabled, showGrid: enabled };
        persistSettings(precount, next);
        return next;
      });
    })();
  };

  const handleMetronomeChange = (partial: Partial<MetronomeSettings>) => {
    setMetronome((current) => {
      const next = { ...current, ...partial };
      persistSettings(precount, next);
      return next;
    });
  };

  const handleRecord = () => {
    void (async () => {
      if (metronome.enabled && !(await isHeadphonesConnected())) {
        Alert.alert(METRONOME_HEADPHONES_TITLE, METRONOME_HEADPHONES_MESSAGE);
        return;
      }
      persistSettings(precount, metronome);
      onRecord({ precount, metronome });
    })();
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.root, { bottom: bottomOffset }]}>
        <View style={styles.row}>
          <View style={styles.side}>
            <MetronomeButton
              disabled={disabled}
              settings={metronome}
              onOpenSettings={() => setMetronomeSettingsVisible(true)}
              onToggle={handleMetronomeToggle}
            />
          </View>
          <RecordButton disabled={disabled} onPress={handleRecord} />
          <View style={styles.side}>
            <PrecountButton
              disabled={disabled}
              mode={precount}
              onCycle={handlePrecountCycle}
            />
          </View>
        </View>
      </View>

      <MetronomeSettingsSheet
        settings={metronome}
        visible={metronomeSettingsVisible}
        onChange={handleMetronomeChange}
        onClose={() => setMetronomeSettingsVisible(false)}
      />
    </>
  );
}

function useStyles() {
  return useMemo(
    () =>
      StyleSheet.create({
        root: {
          position: 'absolute',
          left: 0,
          right: 0,
          alignItems: 'center',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 20,
        },
        side: {
          width: 32,
          alignItems: 'center',
          justifyContent: 'center',
        },
      }),
    []
  );
}
