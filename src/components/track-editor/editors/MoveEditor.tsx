import { StyleSheet, View } from 'react-native';

import type { MoveSnapSelection } from '@/src/audio/moveSnap';
import { getMoveSnapOptions } from '@/src/audio/moveSnap';
import type { MetronomeSettings } from '@/src/storage/types';

import { PresetPills } from '../primitives/PresetPills';

type Props = {
  settings: MetronomeSettings;
  selection: MoveSnapSelection;
  onChange: (selection: MoveSnapSelection) => void;
};

export function MoveEditor({ settings, selection, onChange }: Props) {
  const options = getMoveSnapOptions(settings);

  return (
    <View style={styles.container}>
      <View style={styles.presetRow}>
        <PresetPills
          align="center"
          compact
          options={options}
          selectedId={selection}
          onSelect={onChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  presetRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
