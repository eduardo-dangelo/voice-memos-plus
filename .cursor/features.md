# Feature inventory

Status: `locked` = must not regress · `evolving` = still iterating

Keep entries thin: one-sentence What, 2–5 Paths, 2–4 Invariants. Newest first.

<!-- Entries below -->

### iPhone Duo side column
- Status: evolving
- What: When a side column is present, home, memo-list, and editor icon buttons move into it in black and white, and a rounded glass platter sits behind the editor's column buttons.
- Paths: `src/hooks/useDuoSideColumn.ts`, `app/index.tsx`, `src/components/RecordingsList.tsx`, `src/components/MemoEditor.tsx`, `src/components/GroupedList.tsx`
- Invariants: iPhone and iPad keep the current headers and edge-to-edge editor; on Duo, editor content stays full-bleed and one rounded glass platter covers the editor's two column buttons.
- Updated: 2026-10-23
