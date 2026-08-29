import { RecordingPromptDialog } from '@/src/components/RecordingPromptDialog';

export type HeadphonesRecommendedDialogProps = {
  visible: boolean;
  onCancel: () => void;
  onContinue: () => void;
};

export function HeadphonesRecommendedDialog({
  visible,
  onCancel,
  onContinue,
}: HeadphonesRecommendedDialogProps) {
  return (
    <RecordingPromptDialog
      visible={visible}
      title="Headphones recommended"
      heroIcon="headphones"
      message="Without headphones, playback will leak into the new track through the microphone. Are you sure you want to continue?"
      actions="confirm"
      onDismiss={onCancel}
      onContinue={onContinue}
    />
  );
}
