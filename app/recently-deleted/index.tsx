import { RecordingsList } from '@/src/components/RecordingsList';

export default function RecentlyDeletedScreen() {
  return (
    <RecordingsList
      allowMoveToFolder={false}
      backTitle="Recently Deleted"
      emptySubtitle="Deleted recordings appear here for 30 days."
      emptyTitle="No Deleted Recordings"
      scope={{ kind: 'trash' }}
      showRecordButton={false}
    />
  );
}
