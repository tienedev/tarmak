import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { ListView } from '@/components/board/ListView'
import { TimelineView } from '@/components/board/TimelineView'
import { ViewSwitcher, type ViewMode } from '@/components/board/ViewSwitcher'
import { PresenceAvatars } from '@/components/presence/PresenceAvatars'
import { TaskDialog } from '@/components/board/TaskDialog'
import { SharePopover } from '@/components/board/SharePopover'
import { FilterBar } from '@/components/filters/FilterBar'
import { FieldManager } from '@/components/fields/FieldManager'
import { useFilteredTasks } from '@/hooks/useFilters'
import { useSync } from '@/hooks/useSync'
import { usePresence } from '@/hooks/usePresence'
import type { Task } from '@/lib/api'
import { ActivityPanel } from '@/components/board/ActivityPanel'
import { LabelManager } from '@/components/board/LabelManager'
import { SearchBar } from '@/components/board/SearchBar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { ArrowLeft, History, Loader2, MoreHorizontal, Settings2 } from 'lucide-react'

function getInitialView(): ViewMode {
  const hash = window.location.hash
  const match = hash.match(/[?&]view=(kanban|list|timeline)/)
  return (match?.[1] as ViewMode) ?? 'kanban'
}

interface BoardPageProps {
  boardId: string
}

export function BoardPage({ boardId }: BoardPageProps) {
  const { currentBoard, columns, tasks, members, loading, fetchBoard, clearCurrentBoard } =
    useBoardStore()
  const user = useAuthStore((s) => s.user)

  const [view, setView] = useState<ViewMode>(getInitialView)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  // Real-time sync and presence
  const { provider } = useSync(boardId)
  const presenceUsers = usePresence(provider, user?.name ?? 'Anonymous')

  // Filter tasks
  const filteredTasks = useFilteredTasks(tasks)

  useEffect(() => {
    fetchBoard(boardId)
    return () => clearCurrentBoard()
  }, [boardId, fetchBoard, clearCurrentBoard])

  // Keep selected task in sync with store
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find((t) => t.id === selectedTask.id)
      if (updated) {
        setSelectedTask(updated)
      } else {
        // Task was deleted
        setSelectedTask(null)
        setDetailOpen(false)
      }
    }
  }, [tasks, selectedTask])

  // Persist view mode in hash
  function handleViewChange(v: ViewMode) {
    setView(v)
    const base = window.location.hash.split('?')[0]
    window.location.hash = v === 'kanban' ? base : `${base}?view=${v}`
  }

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task)
    setDetailOpen(true)
  }, [])

  const handleDetailClose = useCallback(() => {
    setDetailOpen(false)
    // Delay clearing so the close animation finishes
    setTimeout(() => setSelectedTask(null), 200)
  }, [])

  const handleSearchSelect = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (task) {
        setSelectedTask(task)
        setDetailOpen(true)
      }
    },
    [tasks],
  )

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

  if (!currentBoard) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Board not found</p>
        <Button variant="outline" size="sm" onClick={() => (window.location.hash = '#/')}>
          <ArrowLeft className="size-3.5" data-icon="inline-start" />
          Back to boards
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Board header — glass */}
      <header className="flex h-14 shrink-0 items-center gap-3 glass-heavy glass-border px-6">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back to boards"
          onClick={() => (window.location.hash = '#/')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="flex-1 overflow-hidden">
          <h1 className="truncate text-sm font-bold">
            {currentBoard.name}
          </h1>
        </div>

        <SearchBar boardId={boardId} onSelectResult={handleSearchSelect} />

        <ViewSwitcher value={view} onChange={handleViewChange} />

        <SharePopover boardId={boardId} />

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
      </header>

      {/* Filter bar */}
      <FilterBar />

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {view === 'kanban' && (
          <KanbanBoard
            filteredTasks={filteredTasks}
            onTaskClick={handleTaskClick}
          />
        )}
        {view === 'list' && (
          <ListView
            columns={columns}
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
          />
        )}
        {view === 'timeline' && (
          <TimelineView
            columns={columns}
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
          />
        )}
      </div>

      {/* Task detail dialog */}
      <TaskDialog
        task={selectedTask}
        open={detailOpen}
        onClose={handleDetailClose}
      />

      {/* Field manager dialog */}
      <FieldManager open={fieldsOpen} onClose={() => setFieldsOpen(false)} />

      <ActivityPanel
        boardId={boardId}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        members={members}
      />
    </div>
  )
}
