import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { LayerEffects, LayerEffectsChange } from '@/src/audio/layerEffects';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EffectCustomDialog, type EffectCustomKind } from './EffectCustomDialog';
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
  onConfirm?: () => void;
  onCancel?: () => void;
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
  onEffectsChange,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const canvasHeight = getEditorCanvasHeight(activeTool);
  const volumeCompact = activeTool === 'volume';
  const draftActions = activeTool === 'trim' || activeTool === 'move';
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
            volumeCompact && styles.contentVolumeCompact,
            draftActions && styles.contentDraftActions,
          ]}>
          {draftActions && onConfirm && onCancel ? (
            <View style={styles.draftActions}>
              <Pressable
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onCancel();
                }}
                style={styles.pill}>
                <SymbolView
                  name={{ ios: 'xmark' }}
                  size={16}
                  tintColor={colors.text}
                />
              </Pressable>
              <Pressable
                accessibilityLabel="Confirm"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onConfirm();
                }}
                style={[styles.pill, styles.pillSelected]}>
                <SymbolView
                  name={{ ios: 'checkmark' }}
                  size={16}
                  tintColor={colors.pillTextSelected}
                />
              </Pressable>
            </View>
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
          paddingHorizontal: 16,
          paddingVertical: 4,
        },
        contentEffectsCompact: {
          paddingVertical: 2,
        },
        contentVolumeCompact: {
          paddingVertical: 2,
        },
        contentDraftActions: {
          justifyContent: 'center',
          paddingVertical: 2,
        },
        draftActions: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingHorizontal: 6,
        },
        pill: {
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 56,
          paddingHorizontal: 20,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: colors.waveformBandBackground,
        },
        pillSelected: {
          backgroundColor: colors.accent,
        },
      }),
    [colors]
  );
}
