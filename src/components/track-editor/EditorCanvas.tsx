import { StyleSheet, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';

import { DelayEditor } from './editors/DelayEditor';
import { EQEditor } from './editors/EQEditor';
import { ReverbEditor } from './editors/ReverbEditor';
import { VolumeEditor } from './editors/VolumeEditor';
import { getEditorCanvasHeight, type EditorTool } from './types';

type EffectsChange = LayerEffectsChange;

type Props = {
  activeTool: EditorTool | null;
  effects: LayerEffects;
  layerDuration: number;
  onEffectsChange: (partial: EffectsChange) => void;
};

export function EditorCanvas({
  activeTool,
  effects,
  layerDuration,
  onEffectsChange,
}: Props) {
  const canvasHeight = getEditorCanvasHeight(activeTool, effects);
  const reverbCompact = activeTool === 'reverb' && effects.reverb.preset !== 'custom';
  const delayCompact = activeTool === 'delay' && effects.delay.preset !== 'custom';
  const eqCompact = activeTool === 'eq' && effects.eq.preset !== 'custom';
  const volumeCompact = activeTool === 'volume';

  if (canvasHeight === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { height: canvasHeight }]}>
      <View
        style={[
          styles.content,
          { height: canvasHeight },
          reverbCompact && styles.contentReverbCompact,
          delayCompact && styles.contentReverbCompact,
          eqCompact && styles.contentReverbCompact,
          volumeCompact && styles.contentVolumeCompact,
        ]}>
        {activeTool === 'volume' ? (
          <VolumeEditor
            effects={effects}
            onChange={(volumeDb) => onEffectsChange({ volumeDb })}
          />
        ) : null}
        {activeTool === 'reverb' ? (
          <ReverbEditor
            effects={effects}
            onChange={(reverb) => onEffectsChange({ reverb })}
          />
        ) : null}
        {activeTool === 'delay' ? (
          <DelayEditor
            effects={effects}
            onChange={(delay) => onEffectsChange({ delay })}
          />
        ) : null}
        {activeTool === 'eq' ? (
          <EQEditor
            effects={effects}
            onChange={(eq) => onEffectsChange({ eq })}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: VoiceMemosColors.separator,
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  contentReverbCompact: {
    paddingVertical: 2,
  },
  contentVolumeCompact: {
    paddingVertical: 2,
  },
});
