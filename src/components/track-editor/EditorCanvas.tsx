import { StyleSheet, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import type { LayerEffects } from '@/src/audio/layerEffects';

import { DelayEditor } from './editors/DelayEditor';
import { EQEditor } from './editors/EQEditor';
import { ReverbEditor } from './editors/ReverbEditor';
import { TrimEditor } from './editors/TrimEditor';
import { VolumeEditor } from './editors/VolumeEditor';
import { getEditorCanvasHeight, type EditorTool } from './types';

type EffectsChange = Partial<LayerEffects> & {
  reverb?: Partial<LayerEffects['reverb']>;
  delay?: Partial<LayerEffects['delay']>;
  eq?: Partial<LayerEffects['eq']>;
};

type Props = {
  activeTool: EditorTool | null;
  effects: LayerEffects;
  layerDuration: number;
  onEffectsChange: (partial: EffectsChange) => void;
  onTrimSave?: () => void;
  savingTrim?: boolean;
};

export function EditorCanvas({
  activeTool,
  effects,
  layerDuration,
  onEffectsChange,
  onTrimSave,
  savingTrim = false,
}: Props) {
  const canvasHeight = getEditorCanvasHeight(activeTool);

  if (canvasHeight === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { height: canvasHeight }]}>
      <View style={[styles.content, { height: canvasHeight }]}>
        {activeTool === 'trim' ? (
          <TrimEditor
            effects={effects}
            isSaving={savingTrim}
            layerDuration={layerDuration}
            onReset={() => onEffectsChange({ trimIn: 0, trimOut: layerDuration })}
            onSave={() => onTrimSave?.()}
          />
        ) : null}
        {activeTool === 'volume' ? (
          <VolumeEditor
            effects={effects}
            onChange={(volumeDb) => onEffectsChange({ volumeDb })}
          />
        ) : null}
        {activeTool === 'reverb' ? (
          <ReverbEditor
            effects={effects}
            onChange={(reverb) => onEffectsChange({ reverb: { ...effects.reverb, ...reverb } })}
          />
        ) : null}
        {activeTool === 'delay' ? (
          <DelayEditor
            effects={effects}
            onChange={(delay) => onEffectsChange({ delay: { ...effects.delay, ...delay } })}
          />
        ) : null}
        {activeTool === 'eq' ? (
          <EQEditor
            effects={effects}
            onChange={(bands) => onEffectsChange({ eq: { bands } })}
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
});
