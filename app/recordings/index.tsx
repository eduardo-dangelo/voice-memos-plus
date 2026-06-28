import { RecordingsList } from '@/src/components/RecordingsList';

export default function AllRecordingsScreen() {
  return <RecordingsList backTitle="All Recordings" scope={{ kind: 'all' }} />;
}
