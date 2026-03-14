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
import { ArrowLeft, History, Loader2, Settings2 } from 'lucide-react'

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

  if (loading && !currentBoard) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
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
      {/* Board header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => (window.location.hash = '#/')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="flex-1 overflow-hidden">
          <h1 className="truncate text-sm font-semibold">
            {currentBoard.name}
          </h1>
        </div>

        <ViewSwitcher value={view} onChange={handleViewChange} />

        <SharePopover boardId={boardId} />

        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-xs text-muted-foreground"
          onClick={() => setActivityOpen(true)}
        >
          <History className="size-3.5" />
          Activity
        </Button>

        {/* Fields button */}
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 text-xs text-muted-foreground"
          onClick={() => setFieldsOpen(true)}
        >
          <Settings2 className="size-3.5" />
          Fields
        </Button>

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
