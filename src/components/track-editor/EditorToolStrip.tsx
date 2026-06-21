import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

import { EDITOR_TOOLS, EDITOR_STRIP_HEIGHT, type EditorTool } from './types';

type Props = {
  activeTool: EditorTool | null;
  onToolChange: (tool: EditorTool | null) => void;
};

export function EditorToolStrip({ activeTool, onToolChange }: Props) {
  const handlePress = (tool: EditorTool) => {
    void Haptics.selectionAsync();
    onToolChange(activeTool === tool ? null : tool);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        contentContainerStyle={styles.row}
        showsHorizontalScrollIndicator={false}>
        {EDITOR_TOOLS.map((tool) => {
          const selected = activeTool === tool.id;
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
                tintColor={selected ? VoiceMemosColors.accent : VoiceMemosColors.text}
              />
              <Text style={[styles.label, selected && styles.labelSelected]}>{tool.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: EDITOR_STRIP_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: VoiceMemosColors.separator,
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
    backgroundColor: 'rgba(0, 122, 255, 0.12)',
  },
  label: {
    fontSize: 11,
    color: VoiceMemosColors.secondaryText,
  },
  labelSelected: {
    color: VoiceMemosColors.accent,
    fontWeight: '500',
  },
});
