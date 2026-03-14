import { useState, useCallback, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { Task } from '@/lib/api'
import { useBoardStore } from '@/stores/board'
import { KanbanColumn } from './KanbanColumn'
import { AddColumnForm } from './AddColumnForm'
import { TaskCardOverlay } from './TaskCard'

interface KanbanBoardProps {
  filteredTasks?: Task[]
  onTaskClick?: (task: Task) => void
}

export function KanbanBoard({ filteredTasks, onTaskClick }: KanbanBoardProps) {
  const { currentBoard, columns, tasks, moveTask } = useBoardStore()
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [localTasks, setLocalTasks] = useState<Task[] | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  )

  // Use localTasks during drag for optimistic updates, otherwise use filtered or store tasks
  const activeTasks = localTasks ?? (filteredTasks ?? tasks)

  const tasksByColumn = useCallback(
    (columnId: string) =>
      activeTasks
        .filter((t) => t.column_id === columnId)
        .sort((a, b) => a.position - b.position),
    [activeTasks],
  )

  const findTaskColumn = useCallback(
    (taskId: string) => {
      // During drag we need to look in localTasks (which uses full task set)
      const searchTasks = localTasks ?? tasks
      const task = searchTasks.find((t) => t.id === taskId)
      return task?.column_id
    },
    [localTasks, tasks],
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id)
      if (task) {
        setActiveTask(task)
        setLocalTasks([...tasks])
      }
    },
    [tasks],
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over || !localTasks) return

      const activeId = active.id as string
      const overId = over.id as string

      const activeColumnId = findTaskColumn(activeId)
      // overId could be a task ID or a column ID
      const overColumnId = columns.find((c) => c.id === overId)
        ? overId
        : findTaskColumn(overId)

      if (!activeColumnId || !overColumnId || activeColumnId === overColumnId) return

      // Move task to a different column
      setLocalTasks((prev) => {
        if (!prev) return prev
        return prev.map((t) =>
          t.id === activeId ? { ...t, column_id: overColumnId } : t,
        )
      })
    },
    [localTasks, columns, findTaskColumn],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveTask(null)

      if (!over || !localTasks || !currentBoard) {
        setLocalTasks(null)
        return
      }

      const activeId = active.id as string
      const overId = over.id as string

      const activeColumnId = findTaskColumn(activeId)
      // overId could be a task ID or a column ID
      const targetColumnId = columns.find((c) => c.id === overId)
        ? overId
        : findTaskColumn(overId)

      if (!activeColumnId || !targetColumnId) {
        setLocalTasks(null)
        return
      }

      // Calculate new position
      const columnTasks = localTasks
        .filter((t) => t.column_id === targetColumnId)
        .sort((a, b) => a.position - b.position)

      let newPosition: number

      if (activeId === overId) {
        // Dropped in place
        const task = localTasks.find((t) => t.id === activeId)
        newPosition = task?.position ?? 0
      } else if (columns.find((c) => c.id === overId)) {
        // Dropped directly on a column - put at the end
        newPosition = columnTasks.length
      } else {
        // Dropped on another task - find its index
        const overIndex = columnTasks.findIndex((t) => t.id === overId)
        const activeIndex = columnTasks.findIndex((t) => t.id === activeId)

        if (activeIndex !== -1 && overIndex !== -1) {
          // Same column reorder
          const reordered = arrayMove(columnTasks, activeIndex, overIndex)
          // Apply reordered positions optimistically
          const updated = localTasks.map((t) => {
            const idx = reordered.findIndex((rt) => rt.id === t.id)
            if (idx !== -1) {
              return { ...t, position: idx }
            }
            return t
          })
          setLocalTasks(updated)
          newPosition = overIndex
        } else {
          newPosition = overIndex === -1 ? columnTasks.length : overIndex
        }
      }

      // Fire API call
      try {
        await moveTask(currentBoard.id, activeId, targetColumnId, newPosition)
      } catch {
        // On failure, revert by clearing local state (store will have original)
      }

      setLocalTasks(null)
    },
    [localTasks, currentBoard, columns, findTaskColumn, moveTask],
  )

  if (!currentBoard) return null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto overflow-y-hidden p-6 pb-4">
        {sortedColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={tasksByColumn(column.id)}
            boardId={currentBoard.id}
            onTaskClick={onTaskClick}
          />
        ))}

        <AddColumnForm boardId={currentBoard.id} />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
