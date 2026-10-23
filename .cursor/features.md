# Feature inventory

Status: `locked` = must not regress · `evolving` = still iterating

Keep entries thin: one-sentence What, 2–5 Paths, 2–4 Invariants. Newest first.

<!-- Entries below -->

### iPhone Duo side column
- Status: evolving
- What: On an iPhone, a closed side-column inset or a regular size class moves home, memo-list, and editor icon buttons into the column in black and white. The editor glass platter is only the closed column.
- Paths: `src/hooks/useDuoSideColumn.ts`, `src/components/RecordingsSplitView.tsx`, `src/components/RecordingsList.tsx`, `src/components/RecordingRow.tsx`, `src/components/MemoEditor.tsx`
- Invariants: iPad, including mini and Split View, keeps the split view, current headers, and hidden list mini tracks; portrait iPhone keeps its header; the open Duo uses the phone list stack, column icons, and expanded mini tracks. The open editor stays a full screen.
- Updated: 2026-10-23
