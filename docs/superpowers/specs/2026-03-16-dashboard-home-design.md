# Dashboard Home — Design Spec

## Problem

The "All Boards" page duplicates the sidebar: both list boards and offer a "New Board" button. This page needs to justify its existence by surfacing useful, cross-board information the sidebar cannot show.

## Solution

Replace the boards list with a personal dashboard containing three sections: stats strip, task list ("Up Next"), and cross-board activity feed.

## Sections

### 1. Stats Strip

Four glass cards in a horizontal row showing aggregated numbers across all boards the user is a member of.

| Stat | Value | Color | Subtitle |
|------|-------|-------|----------|
| My Tasks | Count of tasks assigned to current user (not archived) | Default foreground | "across N boards" |
| Overdue | Tasks with `due_date < today` | Red (`destructive`) | "needs attention" |
| Due Soon | Tasks with `due_date` within next 3 days (not overdue) | Amber | "within 3 days" |
| Done This Week | Tasks moved to a "done" column or archived this week | Green | contextual ("nice momentum", etc.) |

**Responsive:** 4-col grid on desktop, 2x2 on mobile (`grid-cols-2 lg:grid-cols-4`).

**Note on "Done This Week":** Requires counting `task_archived` activity entries from the rolling last 7 days across all boards. Since there's no explicit "done" column semantic, we use archived tasks as a proxy for completion. Fetched via `GET /boards/{id}/activity?action=task_archived&limit=50` per board, then filtered client-side by `created_at >= now - 7 days`.

### 2. Up Next — My Tasks

A list of tasks assigned to the current user, sorted by deadline (earliest first, tasks without a due date at the end).

Each task row shows:
- **Priority indicator** — colored vertical bar on the left (red=urgent, amber=high, purple=medium, gray=low)
- **Title** — task name, clickable
- **Board name** — subtitle in muted text
- **Deadline** — relative date ("yesterday", "tomorrow", "Mar 19") or "No date"
- **Priority badge** — text label

Visual treatment:
- Overdue tasks get a red-tinted background (`destructive/4%` bg, `destructive/10%` border)
- Normal tasks use standard glass surface
- Tasks without a date are slightly dimmed (opacity 0.7)
- Click navigates to `#/boards/{boardId}` (opens the board where the task lives). Deep-linking to a specific task within the board is out of scope for MVP.

**Board name resolution:** Each task has `board_id` but not a board name. Map via the `boards[]` array already in the board store (populated on app init by `fetchBoards()`).

**Data source:** Fetch tasks from each board where `assignee === currentUser.id` and `archived === false`. Aggregate and sort client-side.

### 3. Activity Feed

A chronological feed of recent activity across all boards the user belongs to.

Each entry shows:
- **Avatar** — user initial in a colored circle (deterministic color from user ID)
- **Action text** — "{User} {action} {target}" with bold emphasis on user and target
- **Board name + relative time** — muted subtitle

Shows the most recent ~20 entries. No pagination needed for MVP — scroll within the panel.

**Data source:** Fetch activity from each board (`GET /boards/{id}/activity?limit=10`), merge, sort by `created_at` desc, take top 20. Known limitation: if one board has >10 very recent entries, some may be missed due to the per-board limit. Acceptable for MVP.

## Layout

```
┌──────────────────────────────────────────────────┐
│  Header (glass-heavy): "Dashboard"    March 16   │
├───────────┬───────────┬───────────┬──────────────┤
│  My Tasks │  Overdue  │ Due Soon  │ Done Week    │
│     7     │     2     │     3     │     12       │
├───────────┴───────────┼───────────┴──────────────┤
│                       │                          │
│   Up Next             │   Recent Activity        │
│                       │                          │
│   • Fix login (ovd)   │   You moved "Fix login"  │
│   • Update docs (ovd) │   Alex completed "Auth"  │
│   • Design review     │   Sara assigned you ...  │
│   • Refactor auth     │   You completed subtasks │
│   • Add dark mode     │   Alex created "Caching" │
│                       │                          │
└───────────────────────┴──────────────────────────┘
```

- Header: `glass-heavy glass-border`, same pattern as existing page headers
- Stats: `glass glass-border` cards
- Up Next & Activity: `glass glass-border` panels, side by side on desktop, stacked on mobile

## Backend Considerations

**No new endpoints needed for MVP.** The frontend aggregates data from existing endpoints:

1. `GET /boards` — reuse boards already in the Zustand store (fetched on app init), no extra call
2. `GET /boards/{id}/tasks?limit=500` — per-board, filter by `assignee` client-side
3. `GET /boards/{id}/activity?limit=10` — per-board, merge client-side for the feed
4. `GET /boards/{id}/activity?action=task_archived&limit=50` — per-board, for "Done This Week" stat

**Performance concern:** For users with many boards, this means N API calls per section. Acceptable for MVP (most users have <10 boards). A future `GET /dashboard` endpoint could aggregate server-side. Client-side mitigation: cache dashboard data in component state, skip re-fetch if navigating back within 30 seconds.

## Frontend Changes

### New/Modified Files

| File | Change |
|------|--------|
| `pages/BoardsListPage.tsx` | Replace entirely with dashboard implementation (rename to `DashboardPage.tsx`) |
| `lib/api.ts` | Extend `listTasks()` to accept optional `limit`/`offset` params (currently hardcoded with no params, defaults to 100 server-side) |
| `stores/board.ts` | Reuse existing `boards` from store; dashboard fetches tasks/activity directly via `api` |
| `App.tsx` | Update import from `BoardsListPage` to `DashboardPage` |

### Routing

No changes — dashboard remains at `#/` (same route as the old boards list).

### Sidebar

The "New Board" button stays in the sidebar. The sidebar remains the primary board navigation. No changes needed.

## States

### Loading
While fetching, show skeleton placeholders: 4 shimmer rectangles for the stats strip, and two shimmer panels below. Use the same glass surfaces with a pulsing opacity animation.

### Empty (new user, zero boards)
Show a centered empty state similar to the current one: glass icon container with `LayoutDashboard`, "Welcome to Kanwise" heading, "Create your first board to get started" subtitle. No stats or panels — just the welcome message. The sidebar's "New Board" button is the CTA.

### Partial failure
If one board's fetch fails, skip it silently and show data from the boards that succeeded. No error banner unless all fetches fail, in which case show a simple "Could not load dashboard" message with a retry button.

## Styling

All surfaces use existing Liquid Glass design tokens:
- `glass` / `glass-heavy` / `glass-border` utilities
- `--foreground`, `--muted-foreground` for text
- `--destructive` for overdue indicators
- Standard `rounded-2xl` border radius

No new CSS variables or utilities needed.

## Out of Scope

- Board cards on the dashboard (user explicitly removed this)
- "New Board" button on the dashboard (sidebar handles this)
- Server-side aggregation endpoint (future optimization)
- Charts or graphs (keep it simple for MVP)
- Notification integration
- Drag-and-drop on dashboard tasks
- Deep-linking to a specific task from dashboard click (navigates to board only)
- Server-side date range filtering on activity endpoint
