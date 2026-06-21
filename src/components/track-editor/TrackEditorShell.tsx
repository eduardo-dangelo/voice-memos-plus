import { StyleSheet, View } from 'react-native';

import type { LayerEffects } from '@/src/audio/layerEffects';

import { EditorCanvas } from './EditorCanvas';
import { EditorToolStrip } from './EditorToolStrip';
import { type EditorTool } from './types';

type Props = {
  visible: boolean;
  activeTool: EditorTool | null;
  effects: LayerEffects;
  layerDuration: number;
  onToolChange: (tool: EditorTool | null) => void;
  onEffectsChange: (partial: Partial<LayerEffects> & {
    reverb?: Partial<LayerEffects['reverb']>;
    delay?: Partial<LayerEffects['delay']>;
    eq?: Partial<LayerEffects['eq']>;
  }) => void;
  onTrimSave?: () => void;
  savingTrim?: boolean;
};

export function TrackEditorShell({
  visible,
  activeTool,
  effects,
  layerDuration,
  onToolChange,
  onEffectsChange,
  onTrimSave,
  savingTrim = false,
}: Props) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.container}>
      <EditorCanvas
        activeTool={activeTool}
        effects={effects}
        layerDuration={layerDuration}
        onEffectsChange={onEffectsChange}
        onTrimSave={onTrimSave}
        savingTrim={savingTrim}
      />
      <EditorToolStrip activeTool={activeTool} onToolChange={onToolChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: -20,
  },
});
