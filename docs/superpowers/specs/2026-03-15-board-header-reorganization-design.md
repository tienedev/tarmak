# Board Header Reorganization — Design Spec

## Problem

The board header action bar mixes view-switching, configuration, and consultation actions in a single cluttered row. No clear grouping or hierarchy.

## Design Decisions

### Structure: 2 horizontal bars

**Bar 1 — Header** (h-14)
```
[←] Board Title          [🔍 Search] [📋 Activity] [📦 Archives] [⚙ Settings] [👤👤+2]
```

**Bar 2 — Sub-nav** (h-10, replaces current FilterBar + ViewSwitcher)
```
[▥ Board | ☰ List | ▤ Timeline]  |  Filter  [Priority ▾] [Status ▾] [Assignee ▾]
```

### Settings Panel (slide-over, right side)

- ~450px wide, slides from right (same pattern as TaskDetail)
- Internal vertical tabs:
  - **Members & Roles** — member list, role management (Admin/Member/Viewer), invite
  - **Labels** — CRUD labels with colors (moved from header)
  - **Custom Fields** — field management (moved from More menu)
  - **WIP Limits** — per-column limits
  - **Danger Zone** — board deletion/archival

### Migration Map

| Element | Before | After |
|---------|--------|-------|
| ViewSwitcher | Header | Sub-nav (left) |
| FilterBar | Separate bar | Merged into sub-nav (right) |
| Labels (🏷) | Header button | Settings > Labels tab |
| Share | Header button | Settings > Members tab |
| Fields | More menu | Settings > Custom Fields tab |
| Activity | More menu | Header button |
| Archives | More menu | Header button |
| More menu (⋮) | Header | Removed (all redistributed) |

## Files Affected

- `frontend/src/pages/BoardPage.tsx` — header restructure, settings panel state
- `frontend/src/components/board/ViewSwitcher.tsx` — move to sub-nav
- `frontend/src/components/filters/FilterBar.tsx` — merge into sub-nav
- `frontend/src/components/board/SharePopover.tsx` — move into settings panel
- `frontend/src/components/board/LabelManager.tsx` — move into settings panel
- New: `frontend/src/components/board/BoardSettingsPanel.tsx`
- New: `frontend/src/components/board/BoardSubNav.tsx`
