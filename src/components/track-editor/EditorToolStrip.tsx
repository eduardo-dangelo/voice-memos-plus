import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { LayerEffects } from '@/src/audio/layerEffects';
import {
  hasActiveDelay,
  hasActiveEq,
  hasActiveReverb,
} from '@/src/audio/layerEffects';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

import { EDITOR_STRIP_HEIGHT, EDITOR_TOOLS, type EditorTool } from './types';

type Props = {
  activeTool: EditorTool | null;
  availableTools?: EditorTool[];
  effects: LayerEffects;
  onToolChange: (tool: EditorTool | null) => void;
};

function isToolApplied(tool: EditorTool, effects: LayerEffects): boolean {
  switch (tool) {
    case 'reverb':
      return hasActiveReverb(effects);
    case 'delay':
      return hasActiveDelay(effects);
    case 'eq':
      return hasActiveEq(effects);
    default:
      return false;
  }
}

export function EditorToolStrip({ activeTool, availableTools, effects, onToolChange }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);

  const handlePress = (tool: EditorTool) => {
    void Haptics.selectionAsync();
    onToolChange(activeTool === tool ? null : tool);
  };

  const tools = availableTools
    ? EDITOR_TOOLS.filter((tool) => availableTools.includes(tool.id))
    : EDITOR_TOOLS;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        contentContainerStyle={styles.row}
        showsHorizontalScrollIndicator={false}>
        {tools.map((tool) => {
          const selected = activeTool === tool.id;
          const applied = isToolApplied(tool.id, effects);
          const highlighted = selected || applied;
          return (
            <Pressable
              key={tool.id}
              accessibilityLabel={tool.label}
              accessibilityState={{ selected }}
              onPress={() => handlePress(tool.id)}
              style={[styles.tool, selected && styles.toolSelected]}>
              <SymbolView
                name={{ ios: tool.symbol }}
                size={22}
                tintColor={highlighted ? colors.accent : colors.text}
              />
              <Text
                style={[
                  styles.label,
                  highlighted && styles.labelHighlighted,
                  selected && styles.labelSelected,
                ]}>
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          height: EDITOR_STRIP_HEIGHT,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
        },
        row: {
          flexGrow: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingHorizontal: 8,
        },
        tool: {
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          minWidth: 64,
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderRadius: 12,
        },
        toolSelected: {
          backgroundColor: colors.toolSelectedBackground,
        },
        label: {
          fontSize: 11,
          color: colors.secondaryText,
        },
        labelHighlighted: {
          color: colors.accent,
        },
        labelSelected: {
          fontWeight: '500',
        },
      }),
    [colors]
  );
}
