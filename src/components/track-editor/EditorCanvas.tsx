import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';
import type { MoveSnapSelection } from '@/src/audio/moveSnap';
import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EffectCustomDialog, type EffectCustomKind } from './EffectCustomDialog';
import { DelayEditor } from './editors/DelayEditor';
import { EQEditor } from './editors/EQEditor';
import { MoveEditor } from './editors/MoveEditor';
import { PanEditor } from './editors/PanEditor';
import { ReverbEditor } from './editors/ReverbEditor';
import { VolumeEditor } from './editors/VolumeEditor';
import { getEditorCanvasHeight, type EditorTool } from './types';

type EffectsChange = LayerEffectsChange;

type Props = {
  activeTool: EditorTool | null;
  effects: LayerEffects;
  layerDuration: number;
  metronomeSettings?: MetronomeSettings;
  moveSnapSelection?: MoveSnapSelection;
  onEffectsChange: (partial: EffectsChange) => void;
  onMoveSnapChange?: (selection: MoveSnapSelection) => void;
};

function effectKindForTool(tool: EditorTool | null): EffectCustomKind | null {
  if (tool === 'reverb' || tool === 'delay' || tool === 'eq') {
    return tool;
  }
  return null;
}

export function EditorCanvas({
  activeTool,
  effects,
  layerDuration,
  metronomeSettings,
  moveSnapSelection,
  onEffectsChange,
  onMoveSnapChange,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const canvasHeight = getEditorCanvasHeight(activeTool);
  const volumeCompact = activeTool === 'volume' || activeTool === 'pan';
  const chipTools =
    activeTool === 'move' ||
    activeTool === 'reverb' ||
    activeTool === 'delay' ||
    activeTool === 'eq';
  const effectKind = effectKindForTool(activeTool);
  const [customDialogVisible, setCustomDialogVisible] = useState(false);

  useEffect(() => {
    setCustomDialogVisible(false);
  }, [activeTool]);

  if (canvasHeight === 0) {
    return null;
  }

  return (
    <>
      <View style={[styles.container, { height: canvasHeight }]}>
        <View
          style={[
            styles.content,
            { height: canvasHeight },
            effectKind != null && styles.contentEffectsCompact,
            chipTools && styles.contentChipTools,
            volumeCompact && styles.contentVolumeCompact,
          ]}>
          {activeTool === 'volume' ? (
            <VolumeEditor
              effects={effects}
              onChange={(volumeDb) => onEffectsChange({ volumeDb })}
            />
          ) : null}
          {activeTool === 'pan' ? (
            <PanEditor
              effects={effects}
              onChange={(pan) => onEffectsChange({ pan })}
            />
          ) : null}
          {activeTool === 'reverb' ? (
            <ReverbEditor
              effects={effects}
              onChange={(reverb) => onEffectsChange({ reverb })}
              onRequestCustomEdit={() => setCustomDialogVisible(true)}
            />
          ) : null}
          {activeTool === 'delay' ? (
            <DelayEditor
              effects={effects}
              onChange={(delay) => onEffectsChange({ delay })}
              onRequestCustomEdit={() => setCustomDialogVisible(true)}
            />
          ) : null}
          {activeTool === 'eq' ? (
            <EQEditor
              effects={effects}
              onChange={(eq) => onEffectsChange({ eq })}
              onRequestCustomEdit={() => setCustomDialogVisible(true)}
            />
          ) : null}
          {activeTool === 'move' && metronomeSettings && moveSnapSelection && onMoveSnapChange ? (
            <MoveEditor
              selection={moveSnapSelection}
              settings={metronomeSettings}
              onChange={onMoveSnapChange}
            />
          ) : null}
        </View>
      </View>
      {effectKind != null ? (
        <EffectCustomDialog
          effect={effectKind}
          effects={effects}
          visible={customDialogVisible}
          onChange={onEffectsChange}
          onClose={() => setCustomDialogVisible(false)}
        />
      ) : null}
    </>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          overflow: 'hidden',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
        },
        content: {
          flex: 1,
          paddingHorizontal: 16,
          paddingVertical: 4,
        },
        contentEffectsCompact: {
          paddingVertical: 2,
        },
        contentChipTools: {
          justifyContent: 'center',
        },
        contentVolumeCompact: {
          paddingVertical: 2,
        },
      }),
    [colors]
  );
}
