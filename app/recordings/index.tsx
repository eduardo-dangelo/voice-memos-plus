import { RecordingsSplitView } from '@/src/components/RecordingsSplitView';

export default function AllRecordingsScreen() {
  return (
    <RecordingsSplitView
      backTitle="All Recordings"
      scope={{ kind: 'all' }}
      title="All Recordings"
    />
  );
}
