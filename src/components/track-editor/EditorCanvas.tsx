import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import type { LayerEffects } from '@/src/audio/layerEffects';

import { DelayEditor } from './editors/DelayEditor';
import { EQEditor } from './editors/EQEditor';
import { ReverbEditor } from './editors/ReverbEditor';
import { TrimEditor } from './editors/TrimEditor';
import { VolumeEditor } from './editors/VolumeEditor';
import { EDITOR_CANVAS_HEIGHT, getEditorCanvasHeight, type EditorTool } from './types';

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
  const height = useSharedValue(0);
  const canvasHeight = getEditorCanvasHeight(activeTool);

  useEffect(() => {
    height.value = withSpring(canvasHeight, {
      damping: 20,
      stiffness: 220,
    });
  }, [activeTool, canvasHeight, height]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: height.value > 0 ? 1 : 0,
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <View style={[styles.content, { height: canvasHeight || EDITOR_CANVAS_HEIGHT }]}>
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
    </Animated.View>
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
