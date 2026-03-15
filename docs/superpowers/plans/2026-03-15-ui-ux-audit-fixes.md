# UI/UX Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 16 issues identified in the UI/UX audit — accessibility, UX, design polish, and refinements.

**Architecture:** Pure frontend changes. No backend work. Touches CSS design tokens, shared utilities, and individual components. Changes grouped by blast radius: global CSS first, then shared utility, then per-component fixes.

**Tech Stack:** React 19 + Tailwind CSS 4 + Base UI + Lucide icons + dnd-kit

> **Note on line numbers:** All line references are based on the initial file state. Earlier tasks may shift line numbers in shared files. Implementers should use **string matching** (old → new) rather than line-number-based replacement.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/index.css` | Add `prefers-reduced-motion`, dark mode border fix, custom scrollbar, glass hover utility |
| Create | `src/lib/color.ts` | Label contrast utility (`isLightColor`) |
| Modify | `src/lib/utils.ts` | Re-export color utility (optional convenience) |
| Modify | `src/components/board/TaskCard.tsx` | Label contrast, cursor fix, grip handle, hover bg, priority icon, due date icon, min font sizes |
| Modify | `src/components/board/KanbanColumn.tsx` | Improved empty state, custom scrollbar class |
| Modify | `src/components/board/KanbanBoard.tsx` | Skeleton loading state |
| Modify | `src/pages/BoardPage.tsx` | Skeleton loading, header overflow menu, aria-labels |
| Modify | `src/pages/LoginPage.tsx` | Spinner on submit button |
| Modify | `src/pages/BoardsListPage.tsx` | Spinner on create button, board card keyboard focus |
| Modify | `src/layouts/AppLayout.tsx` | Responsive sidebar (Sheet on mobile), aria-labels on icon buttons |
| Modify | `src/components/board/AddTaskForm.tsx` | Spinner on submit |
| Modify | `src/components/board/AddColumnForm.tsx` | Spinner on submit |
| Modify | `src/components/notifications/NotificationBell.tsx` | Min font size fix, aria-label |
| Modify | `src/components/settings/ThemeSelector.tsx` | aria-label |

---

## Chunk 1: Global CSS & Shared Utilities

### Task 1: Add `prefers-reduced-motion` media query

**Files:**
- Modify: `src/index.css` (append after line 292)

- [ ] **Step 1: Add reduced motion media query to `index.css`**

At the end of the file, after the `@layer base` block, add:

```css
/* ===================================================================
   Reduced Motion
   =================================================================== */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev` in `frontend/`
In browser DevTools → Rendering → check "Emulate prefers-reduced-motion: reduce"
Expected: No transitions, no spinning loaders, no scale animations

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "fix(a11y): add prefers-reduced-motion media query"
```

---

### Task 2: Increase dark mode glass border visibility

**Files:**
- Modify: `src/index.css:83`

- [ ] **Step 1: Update dark mode `--glass-border` value**

Change:
```css
    --glass-border: oklch(1 0 0 / 8%);
```
To:
```css
    --glass-border: oklch(1 0 0 / 12%);
```

This bumps opacity from 8% to 12%, making card boundaries visible without looking heavy.

- [ ] **Step 2: Verify visually**

Toggle to dark mode. Cards, columns, and sidebar should have slightly more visible borders — subtle but distinguishable from background.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "fix(ui): increase dark mode glass border visibility (8% → 12%)"
```

---

### Task 3: Add custom scrollbar styling

**Files:**
- Modify: `src/index.css` (append a utility)

- [ ] **Step 1: Add thin-scrollbar utility**

After the `@utility glass-border` block (line 274), add:

```css
@utility scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: oklch(0.5 0 0 / 15%) transparent;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(ui): add scrollbar-thin utility for glass aesthetic"
```

---

### Task 4: Create label contrast utility

**Files:**
- Create: `src/lib/color.ts`

- [ ] **Step 1: Create `src/lib/color.ts`**

```typescript
/**
 * Returns true if a hex color is "light" (should use dark text on top).
 * Uses relative luminance approximation from sRGB.
 */
export function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  // Perceived brightness (ITU-R BT.709)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/color.ts
git commit -m "feat: add isLightColor utility for label contrast detection"
```

---

### Task 5: Add glass hover utility

**Files:**
- Modify: `src/index.css` (append after `glass-border` utility)

- [ ] **Step 1: Add `glass-hover` utility class**

After the `@utility scrollbar-thin` block, add:

```css
@utility glass-hover {
  &:hover {
    background: oklch(0.5 0 0 / 3%);
  }
  :is(.dark) &:hover {
    background: oklch(1 0 0 / 3%);
  }
}
```

This provides a subtle tint shift on hover, usable on task cards and other interactive surfaces. Uses simple oklch values (not the `from` relative color syntax) for broad browser compatibility.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(ui): add glass-hover utility for interactive surfaces"
```

---

## Chunk 2: TaskCard Fixes (6 issues)

### Task 6: Fix label contrast

**Files:**
- Modify: `src/components/board/TaskCard.tsx:1-4, 67-84`

- [ ] **Step 1: Import `isLightColor`**

At the top of the file, add import:

```typescript
import { isLightColor } from '@/lib/color'
```

- [ ] **Step 2: Apply dynamic text color to labels**

Replace the labels block (lines 67-84):

```tsx
      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium shadow-sm',
                isLightColor(label.color) ? 'text-gray-900' : 'text-white',
              )}
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-[0.65rem] text-muted-foreground">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify**

Create a task with a yellow (#FACC15) label and a dark (#1E293B) label.
Expected: Yellow label → dark text. Dark label → white text.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx frontend/src/lib/color.ts
git commit -m "fix(a11y): auto-detect label contrast for light/dark text"
```

---

### Task 7: Fix cursor and add drag handle

**Files:**
- Modify: `src/components/board/TaskCard.tsx:1-5, 44-59`

- [ ] **Step 1: Import `GripVertical` icon**

Add to the lucide import (or create one if none exists):

```typescript
import { GripVertical } from 'lucide-react'
```

Note: TaskCard currently has no lucide import — add this new line after the `cn` import.

- [ ] **Step 2: Update card className and add grip handle**

Replace the card container opening (lines 44-60) — change `cursor-grab` to `cursor-pointer`, add `glass-hover`:

```tsx
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={onClick}
      className={cn(
        'group/card cursor-pointer rounded-xl glass-border p-3 transition-all',
        'bg-card backdrop-blur-md glass-hover',
        'shadow-[inset_0_1px_0_oklch(1_0_0/20%),0_1px_3px_oklch(0_0_0/4%)]',
        'hover:shadow-[inset_0_1px_0_oklch(1_0_0/25%),0_2px_8px_oklch(0_0_0/8%)]',
        isDragging && 'opacity-40',
        overlay && 'rotate-[2deg] shadow-[inset_0_1px_0_oklch(1_0_0/20%),0_8px_24px_oklch(0_0_0/12%)]',
      )}
    >
      {/* Drag handle + Title */}
      <div className="flex items-start gap-1.5">
        <span
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 cursor-grab shrink-0 text-muted-foreground/0 transition-colors group-hover/card:text-muted-foreground/40 active:cursor-grabbing"
          aria-label="Drag to reorder"
          role="button"
          tabIndex={0}
        >
          <GripVertical className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {task.title}
        </p>
      </div>
```

Key changes:
- `cursor-grab` → `cursor-pointer` on the card (grab cursor removed from card level)
- `glass-hover` added for subtle hover background
- `{...listeners}` moved from the card to the grip handle only
- `onClick={e => e.stopPropagation()}` on grip handle prevents card onClick when dragging
- `role="button"` + `tabIndex={0}` make the grip handle keyboard-accessible
- Grip handle is invisible (`text-muted-foreground/0`) until hover (`group-hover/card:text-muted-foreground/40`)
- **Note:** Keyboard-initiated drag (Space/Enter) only works from the grip handle, not the card body. This is a deliberate tradeoff to cleanly separate click from drag.

- [ ] **Step 3: Verify**

Hover a task card → pointer cursor + subtle background tint + grip handle fades in on left.
Grab the grip handle → grabbing cursor, card lifts.
Click the card body → opens task detail.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx
git commit -m "fix(ux): separate click from drag — cursor-pointer + grip handle"
```

---

### Task 8: Bump minimum font sizes

**Files:**
- Modify: `src/components/board/TaskCard.tsx` (multiple lines)

- [ ] **Step 1: Replace all `text-[0.6rem]` with `text-[0.65rem]`**

In `TaskCard.tsx`, do a find-and-replace:
- `text-[0.6rem]` → `text-[0.65rem]`

This affects: label text, label overflow count, subtask count, due date, assignee avatar text.

The minimum rendered size becomes ~10.4px instead of ~9.6px.

- [ ] **Step 2: Also fix in NotificationBell.tsx**

In `src/components/notifications/NotificationBell.tsx`, replace:
- `text-[0.6rem]` → `text-[0.65rem]` (notification timestamp, "Mark all read" button)
- `text-[0.5rem]` → `text-[0.6rem]` (badge count)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx frontend/src/components/notifications/NotificationBell.tsx
git commit -m "fix(a11y): bump minimum font size from 0.6rem to 0.65rem"
```

---

### Task 9: Improve priority indicator

**Files:**
- Modify: `src/components/board/TaskCard.tsx:6-11, 86-101`

- [ ] **Step 1: Replace priority dot with small icons**

Replace the `priorityColors` map and the priority render block. Import icons and the `LucideIcon` type:

```typescript
import type { LucideIcon } from 'lucide-react'
import {
  GripVertical,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
} from 'lucide-react'
```

Replace the `priorityColors` and `priorityLabels` maps (lines 6-19) with:

```typescript
const priorityConfig: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus, color: 'text-yellow-500', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-zinc-400', label: 'Low' },
}
```

Inside the component, before the `return`, extract the priority config as a local variable:

```typescript
  const priorityCfg = task.priority && task.priority !== 'none'
    ? priorityConfig[task.priority]
    : undefined
```

Replace the priority dot render block (lines 88-101) with:

```tsx
        {/* Priority icon */}
        {priorityCfg && (
          <div className={cn('flex items-center gap-1', priorityCfg.color)} title={priorityCfg.label}>
            <priorityCfg.icon className="size-3" />
            <span className="text-[0.65rem] font-medium">{priorityCfg.label}</span>
          </div>
        )}
```

Also remove the now-unused `priorityDot` variable (line 42):
```typescript
  const priorityDot = priorityColors[task.priority] ?? priorityColors.none  // DELETE THIS LINE
```

- [ ] **Step 2: Verify**

Create tasks with different priorities.
Expected: Urgent shows triangle icon in red, High shows up arrow in orange, etc.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx
git commit -m "fix(ui): replace priority dots with descriptive icons"
```

---

### Task 10: Add calendar icon to due date

**Files:**
- Modify: `src/components/board/TaskCard.tsx:117-126`

- [ ] **Step 1: Import `Calendar` icon**

Add to the lucide import:

```typescript
import { GripVertical, AlertTriangle, ArrowUp, Minus, ArrowDown, Calendar } from 'lucide-react'
```

- [ ] **Step 2: Add icon before date text**

Replace the due date block (lines 117-126) with:

```tsx
        {/* Due date */}
        {task.due_date && (
          <div className={cn(
            'flex items-center gap-1 text-[0.65rem] font-medium',
            new Date(task.due_date) < new Date() ? 'text-red-500' :
            new Date(task.due_date).getTime() - Date.now() < 2 * 86400000 ? 'text-orange-500' :
            'text-muted-foreground',
          )}>
            <Calendar className="size-3" />
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx
git commit -m "feat(ui): add calendar icon to due date on task cards"
```

---

## Chunk 3: Loading States & Spinners

### Task 11: Add spinner to login button

**Files:**
- Modify: `src/pages/LoginPage.tsx:6, 117-127`

- [ ] **Step 1: Import `Loader2`**

Add to the lucide import (line 6):

```typescript
import { Kanban, Loader2 } from 'lucide-react'
```

- [ ] **Step 2: Replace submit button content**

Replace lines 117-127:

```tsx
              <Button
                type="submit"
                className="mt-1 w-full"
                disabled={loading || !email || !password || (isRegister && !name)}
              >
                {loading && <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />}
                {loading
                  ? 'Signing in…'
                  : isRegister
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
```

- [ ] **Step 3: Verify**

Click "Sign in" → spinner appears while loading.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "fix(ux): add spinner to login button during loading"
```

---

### Task 12: Add spinner to "Create Board" button

**Files:**
- Modify: `src/pages/BoardsListPage.tsx:102-104`

- [ ] **Step 1: Update create board submit button**

Replace line 102-104:

```tsx
              <DialogFooter>
                <Button type="submit" disabled={creating || !newName.trim()}>
                  {creating && <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />}
                  {creating ? 'Creating…' : 'Create Board'}
                </Button>
              </DialogFooter>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/BoardsListPage.tsx
git commit -m "fix(ux): add spinner to create board button"
```

---

### Task 13: Add skeleton loading to BoardPage

**Files:**
- Modify: `src/pages/BoardPage.tsx:99-105`

- [ ] **Step 1: Replace spinner-only loading state**

Replace lines 99-105:

```tsx
  if (loading && !currentBoard) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Skeleton header */}
        <header className="flex h-14 shrink-0 items-center gap-3 glass-heavy glass-border px-6">
          <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="flex-1" />
          <div className="h-6 w-48 animate-pulse rounded-lg bg-muted" />
        </header>
        {/* Skeleton columns */}
        <div className="flex h-full gap-3 overflow-hidden p-6 pb-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex w-72 shrink-0 flex-col rounded-2xl glass-subtle glass-border p-3">
              <div className="mb-3 flex items-center gap-2">
                <div className="size-2.5 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              </div>
              <div className="flex flex-col gap-1.5">
                {[1, 2, 3].slice(0, 3 - i + 1).map((j) => (
                  <div key={j} className="rounded-xl glass-border bg-card p-3">
                    <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
```

- [ ] **Step 2: Verify**

Navigate to a board. The skeleton should show 3 columns with placeholder cards, then resolve to real data.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(ux): skeleton loading state for board page"
```

---

## Chunk 4: Responsive Sidebar

### Task 14: Convert sidebar to responsive (Sheet on mobile)

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

This is the largest single task. The sidebar should:
- Stay as a fixed `w-60` sidebar on `md+` screens
- Collapse to a hamburger → Sheet overlay on `< md`

- [ ] **Step 1: Update imports**

Merge `useState` into the existing React import. Change line 1 from:
```typescript
import type { ReactNode } from 'react'
```
To:
```typescript
import { useState, type ReactNode } from 'react'
```

Add `Menu` to the existing lucide-react import. Change line 8-13 from:
```typescript
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Kanban,
} from 'lucide-react'
```
To:
```typescript
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Kanban,
  Menu,
} from 'lucide-react'
```

Add a new import for Sheet components:
```typescript
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
```

- [ ] **Step 2: Extract sidebar content into a shared function**

Inside the `AppLayout` component, before the `return`, add:

```tsx
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const sidebarContent = (
    <>
      {/* Logo area */}
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Kanban className="size-4" />
        </div>
        <span className="text-sm font-bold tracking-tight">
          Kanwise
        </span>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* Navigation */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <span className="px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Boards
          </span>
        </div>

        <ScrollArea className="flex-1 px-3">
          <nav className="flex flex-col gap-0.5 py-1">
            {boards.map((board) => (
              <a
                key={board.id}
                href={`#/boards/${board.id}`}
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/75 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-sm"
              >
                <LayoutDashboard className="size-3.5 shrink-0 opacity-50" />
                <span className="truncate">{board.name}</span>
              </a>
            ))}
            {boards.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No boards yet
              </p>
            )}
          </nav>
        </ScrollArea>

        <div className="px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => {
              window.location.hash = '#/'
              setSidebarOpen(false)
            }}
          >
            <Plus className="size-3.5" />
            New Board
          </Button>
        </div>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* User area */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary uppercase">
            {user?.name?.charAt(0) ?? '?'}
          </div>
          <span className="truncate text-xs font-medium">
            {user?.name ?? 'Guest'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationBell />
          <ThemeSelector />
          <Button variant="ghost" size="icon-xs" onClick={logout} aria-label="Sign out">
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>
    </>
  )
```

- [ ] **Step 3: Update the JSX return**

Replace the entire `return` with:

```tsx
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col glass glass-border text-sidebar-foreground">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-0 text-sidebar-foreground" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header with hamburger */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 md:hidden glass-heavy glass-border">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </Button>
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Kanban className="size-3.5" />
          </div>
          <span className="text-sm font-bold tracking-tight">Kanwise</span>
        </div>

        {children}
      </main>
    </div>
  )
```

- [ ] **Step 4: Verify**

Resize browser to < 768px. Sidebar should be hidden, hamburger menu visible.
Click hamburger → Sheet slides in from left with navigation.
Click a board → Sheet closes, board loads.
Resize back to >= 768px → normal sidebar.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/layouts/AppLayout.tsx
git commit -m "feat(ux): responsive sidebar — Sheet overlay on mobile, fixed on desktop"
```

---

## Chunk 5: Aria Labels & Accessibility

### Task 15: Add aria-labels to all icon-only buttons

**Files:**
- Modify: `src/pages/BoardPage.tsx:123-129`
- Modify: `src/components/settings/ThemeSelector.tsx`
- Modify: `src/components/notifications/NotificationBell.tsx`

- [ ] **Step 1: BoardPage back button**

In `BoardPage.tsx`, find and replace the back button (around lines 123-129):

```tsx
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => (window.location.hash = '#/')}
          aria-label="Back to boards"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
```

- [ ] **Step 2: ThemeSelector trigger**

In `ThemeSelector.tsx`, update the `DropdownMenuTrigger`:

```tsx
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Change theme" />
        }
      >
```

- [ ] **Step 3: NotificationBell trigger**

In `NotificationBell.tsx`, update the `PopoverTrigger`:

```tsx
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="relative" aria-label="Notifications" />
        }
      >
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx frontend/src/components/settings/ThemeSelector.tsx frontend/src/components/notifications/NotificationBell.tsx
git commit -m "fix(a11y): add aria-labels to all icon-only buttons"
```

---

## Chunk 6: Header Overflow Menu & Empty States

### Task 16: Group secondary actions into overflow menu

**Files:**
- Modify: `src/pages/BoardPage.tsx:119-168`

The board header currently has 7+ items. Move Activity + Fields into a `DropdownMenu` with an ellipsis trigger.

- [ ] **Step 1: Add imports**

Add a new import for DropdownMenu:
```typescript
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
```

Add `MoreHorizontal` to the existing lucide-react import (line 21). Change:
```typescript
import { ArrowLeft, History, Loader2, Settings2 } from 'lucide-react'
```
To:
```typescript
import { ArrowLeft, History, Loader2, MoreHorizontal, Settings2 } from 'lucide-react'
```

- [ ] **Step 2: Replace Activity + Fields buttons with overflow menu**

Find the section from `<LabelManager />` through the Presence avatars closing `</div>` (around lines 142-168) and replace with:

```tsx
        <LabelManager />

        {/* Overflow menu — secondary actions */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="More actions" />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setActivityOpen(true)}>
              <History className="size-3.5" />
              Activity
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFieldsOpen(true)}>
              <Settings2 className="size-3.5" />
              Fields
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Presence avatars */}
        <div className="ml-2">
          <PresenceAvatars users={presenceUsers} />
        </div>
```

- [ ] **Step 3: Verify**

Board header should show: Back | Title | Search | Views | Share | Labels | `⋯` | Presence
Click `⋯` → dropdown with Activity and Fields.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(ux): group secondary header actions into overflow menu"
```

---

### Task 17: Improve empty column state

**Files:**
- Modify: `src/components/board/KanbanColumn.tsx:82-87`

- [ ] **Step 1: Replace plain text empty state**

Replace lines 82-87:

```tsx
          {/* Empty state */}
          {sortedTasks.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-6 text-center">
              <p className="text-[0.65rem] font-medium text-muted-foreground/50">
                No tasks yet
              </p>
              <p className="text-[0.65rem] text-muted-foreground/35">
                Click "Add task" below
              </p>
            </div>
          )}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/KanbanColumn.tsx
git commit -m "feat(ui): improve empty column state with instructive text"
```

---

### Task 18: Apply scrollbar-thin to column scroll areas

**Files:**
- Modify: `src/components/board/KanbanColumn.tsx:68`

- [ ] **Step 1: Add scrollbar-thin class**

Change line 68 from:

```tsx
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-1">
```

To:

```tsx
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pt-2 pb-1">
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/KanbanColumn.tsx
git commit -m "feat(ui): apply thin scrollbar to kanban column scroll areas"
```

---

## Chunk 7: Final Polish

### Task 19: Add spinner to AddTaskForm submit

**Files:**
- Modify: `src/components/board/AddTaskForm.tsx:2, 109-116`

- [ ] **Step 1: Import Loader2**

Change the lucide import (line 2):

```typescript
import { Plus, Loader2 } from 'lucide-react'
```

- [ ] **Step 2: Update Add button**

Replace lines 109-116:

```tsx
        <Button
          size="xs"
          onClick={handleSubmit}
          disabled={!title.trim() || submitting}
          className="h-6 text-xs"
        >
          {submitting && <Loader2 className="size-3 animate-spin" />}
          {submitting ? 'Adding…' : 'Add'}
        </Button>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/AddTaskForm.tsx
git commit -m "fix(ux): add spinner to AddTaskForm submit button"
```

---

### Task 20: Add spinner to AddColumnForm submit

**Files:**
- Modify: `src/components/board/AddColumnForm.tsx:2, 83-90`

- [ ] **Step 1: Import Loader2**

Change the lucide import (line 2):

```typescript
import { Plus, Loader2 } from 'lucide-react'
```

- [ ] **Step 2: Update Add button**

Find and replace the Add button (around lines 83-90):

```tsx
        <Button
          size="xs"
          onClick={handleSubmit}
          disabled={!name.trim() || submitting}
          className="h-6 text-xs"
        >
          {submitting && <Loader2 className="size-3 animate-spin" />}
          {submitting ? 'Adding…' : 'Add'}
        </Button>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/AddColumnForm.tsx
git commit -m "fix(ux): add spinner to AddColumnForm submit button"
```

---

### Task 21: Add keyboard focus ring to board cards

**Files:**
- Modify: `src/pages/BoardsListPage.tsx:139-156`

- [ ] **Step 1: Add focus-visible ring to board card links**

Find and replace the `boards.map` block (around lines 139-156):

```tsx
            {boards.map((board) => (
              <a
                key={board.id}
                href={`#/boards/${board.id}`}
                className="block rounded-2xl transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
              >
                <Card className="h-full cursor-pointer glass glass-border transition-shadow hover:shadow-[inset_0_1px_0_oklch(1_0_0/25%),0_4px_16px_oklch(0_0_0/8%)]">
                  <CardHeader>
                    <CardTitle>{board.name}</CardTitle>
                    {board.description && (
                      <CardDescription className="line-clamp-2">
                        {board.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </a>
            ))}
```

Key change: Added `rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none` to the `<a>` tag.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/BoardsListPage.tsx
git commit -m "fix(a11y): add keyboard focus ring to board cards"
```

---

## Summary

| Chunk | Tasks | Issues Fixed |
|-------|-------|-------------|
| 1. Global CSS & Utilities | 1-5 | `prefers-reduced-motion`, dark border, scrollbar, color util, hover util |
| 2. TaskCard | 6-10 | Label contrast, cursor/drag, font sizes, priority icons, due date icon |
| 3. Loading States | 11-13 | Login spinner, create board spinner, skeleton loading |
| 4. Responsive Sidebar | 14 | Mobile sidebar as Sheet |
| 5. Aria Labels | 15 | Icon-only button accessible names |
| 6. Header & Empty States | 16-18 | Overflow menu, column empty state, thin scrollbar |
| 7. Final Polish | 19-21 | AddTask spinner, AddColumn spinner, board card focus |

**Total: 21 tasks, 16 issues resolved, ~15 commits**
