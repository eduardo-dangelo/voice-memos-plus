# Feature inventory

Status: `locked` = must not regress · `evolving` = still iterating

Keep entries thin: one-sentence What, 2–5 Paths, 2–4 Invariants. Newest first.

<!-- Entries below -->

### iPhone Duo side column
- Status: evolving
- What: When a side column is present, home and memo-list icon buttons move into it in black and white, and list content stays out of that column.
- Paths: `src/hooks/useDuoSideColumn.ts`, `app/index.tsx`, `src/components/RecordingsList.tsx`, `src/components/GroupedList.tsx`, `app/_layout.tsx`
- Invariants: iPhone and iPad keep the glass header, text Edit/Select pills, and spacing; on Duo, Edit is a pencil and Select is a checkbox in the side column; list content is inset by that column on home and memo lists.
- Updated: 2026-10-23
