import { RecordingsSplitView } from '@/src/components/RecordingsSplitView';

export default function RecentlyDeletedScreen() {
  return (
    <RecordingsSplitView
      allowMoveToFolder={false}
      backTitle="Recently Deleted"
      emptySubtitle="Deleted recordings appear here for 30 days."
      emptyTitle="No Deleted Recordings"
      scope={{ kind: 'trash' }}
      showRecordButton={false}
      title="Recently Deleted"
    />
  );
}
