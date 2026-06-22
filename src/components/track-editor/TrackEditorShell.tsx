import { StyleSheet, View } from 'react-native';

import type { LayerEffects } from '@/src/audio/layerEffects';

import { EditorCanvas } from './EditorCanvas';
import { EditorToolStrip } from './EditorToolStrip';
import { type EditorTool } from './types';

type Props = {
  visible: boolean;
  activeTool: EditorTool | null;
  availableTools?: EditorTool[];
  effects: LayerEffects;
  layerDuration: number;
  onToolChange: (tool: EditorTool | null) => void;
  onEffectsChange: (partial: Partial<LayerEffects> & {
    reverb?: Partial<LayerEffects['reverb']>;
    delay?: Partial<LayerEffects['delay']>;
    eq?: Partial<LayerEffects['eq']>;
  }) => void;
};

export function TrackEditorShell({
  visible,
  activeTool,
  availableTools,
  effects,
  layerDuration,
  onToolChange,
  onEffectsChange,
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
      />
      <EditorToolStrip
        activeTool={activeTool}
        availableTools={availableTools}
        onToolChange={onToolChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: -20,
  },
});
