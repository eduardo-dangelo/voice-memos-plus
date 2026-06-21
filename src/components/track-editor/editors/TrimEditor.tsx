import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { isDefaultTrim, type LayerEffects } from '@/src/audio/layerEffects';

type Props = {
  effects: LayerEffects;
  layerDuration: number;
  isSaving?: boolean;
  onReset: () => void;
  onSave: () => void;
};

export function TrimEditor({ effects, layerDuration, isSaving = false, onReset, onSave }: Props) {
  const isDefault = isDefaultTrim(effects, layerDuration);

  return (
    <View style={styles.container}>
      <Pressable
        disabled={isDefault || isSaving}
        onPress={onReset}
        style={[styles.button, (isDefault || isSaving) && styles.buttonDisabled]}>
        <Text style={[styles.buttonText, isDefault && styles.buttonTextDisabled]}>Reset</Text>
      </Pressable>
      <Pressable disabled={isSaving} onPress={onSave} style={styles.saveButton}>
        {isSaving ? (
          <ActivityIndicator color={VoiceMemosColors.accent} size="small" />
        ) : (
          <Text style={styles.saveText}>Save</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 17,
    color: VoiceMemosColors.accent,
  },
  buttonTextDisabled: {
    color: VoiceMemosColors.secondaryText,
  },
  saveButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  saveText: {
    fontSize: 17,
    fontWeight: '600',
    color: VoiceMemosColors.accent,
  },
});
