import { StyleSheet, View } from 'react-native';

import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';

import type { MoveSnapSelection } from '@/src/audio/moveSnap';
import type { MetronomeSettings } from '@/src/storage/types';

import { EditorCanvas } from './EditorCanvas';
import { EditorToolStrip } from './EditorToolStrip';
import { type EditorTool } from './types';

type Props = {
  visible: boolean;
  activeTool: EditorTool | null;
  availableTools?: EditorTool[];
  effects: LayerEffects;
  layerDuration: number;
  metronomeSettings?: MetronomeSettings;
  moveSnapSelection?: MoveSnapSelection;
  onToolChange: (tool: EditorTool | null) => void;
  onEffectsChange: (partial: LayerEffectsChange) => void;
  onMoveSnapChange?: (selection: MoveSnapSelection) => void;
};

export function TrackEditorShell({
  visible,
  activeTool,
  availableTools,
  effects,
  layerDuration,
  metronomeSettings,
  moveSnapSelection,
  onToolChange,
  onEffectsChange,
  onMoveSnapChange,
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
        metronomeSettings={metronomeSettings}
        moveSnapSelection={moveSnapSelection}
        onEffectsChange={onEffectsChange}
        onMoveSnapChange={onMoveSnapChange}
      />
      <EditorToolStrip
        activeTool={activeTool}
        availableTools={availableTools}
        effects={effects}
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
