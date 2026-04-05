import { create } from 'zustand'
import { trpcClient } from '@/lib/trpc'
import type { Board, Column, Task, CustomField, BoardMember, Label } from '@/lib/types'
import { useNotificationStore } from './notifications'

interface BoardState {
  boards: Board[]
  currentBoard: Board | null
  columns: Column[]
  tasks: Task[]
  fields: CustomField[]
  members: BoardMember[]
  labels: Label[]
  loading: boolean
  error: string | null

  fetchBoards: () => Promise<void>
  fetchBoard: (id: string) => Promise<void>
  createBoard: (name: string, description?: string) => Promise<Board>
  deleteBoard: (id: string) => Promise<void>
  createColumn: (boardId: string, name: string, color?: string) => Promise<Column>
  createTask: (
    boardId: string,
    columnId: string,
    title: string,
    priority?: string,
  ) => Promise<Task>
  moveTask: (
    boardId: string,
    taskId: string,
    columnId: string,
    position: number,
  ) => Promise<void>
  updateTask: (
    boardId: string,
    taskId: string,
    data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>,
  ) => Promise<void>
  deleteTask: (boardId: string, taskId: string) => Promise<void>
  createLabel: (boardId: string, name: string, color: string) => Promise<Label>
  updateLabel: (boardId: string, labelId: string, data: { name?: string; color?: string }) => Promise<void>
  deleteLabel: (boardId: string, labelId: string) => Promise<void>
  addTaskLabel: (boardId: string, taskId: string, labelId: string) => Promise<void>
  removeTaskLabel: (boardId: string, taskId: string, labelId: string) => Promise<void>
  archiveTask: (boardId: string, taskId: string) => Promise<void>
  unarchiveTask: (boardId: string, taskId: string) => Promise<void>
  updateColumn: (
    boardId: string,
    columnId: string,
    data: { name?: string; color?: string | null },
  ) => Promise<void>
  deleteColumn: (boardId: string, columnId: string) => Promise<void>
  moveColumn: (boardId: string, columnId: string, position: number) => Promise<void>
  archiveColumn: (boardId: string, columnId: string) => Promise<void>
  unarchiveColumn: (boardId: string, columnId: string) => Promise<void>
  duplicateTask: (boardId: string, taskId: string) => Promise<Task>
  duplicateBoard: (boardId: string, name: string, includeTasks?: boolean) => Promise<Board>
  clearCurrentBoard: () => void
}

function notify(message: string) {
  useNotificationStore.getState().add(message)
}

export const useBoardStore = create<BoardState>((set, get) => ({
  boards: [],
  currentBoard: null,
  columns: [],
  tasks: [],
  fields: [],
  members: [],
  labels: [],
  loading: false,
  error: null,

  fetchBoards: async () => {
    set({ loading: true, error: null })
    try {
      const boards = await trpcClient.board.list.query() as Board[]
      set({ boards, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch boards'
      set({ error: message, loading: false })
    }
  },

  fetchBoard: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const [board, columns, tasks, fields, rawMembers, labels] = await Promise.all([
        trpcClient.board.get.query({ boardId: id }),
        trpcClient.column.list.query({ boardId: id }),
        trpcClient.task.list.query({ boardId: id }),
        trpcClient.customField.list.query({ boardId: id }),
        trpcClient.board.listMembers.query({ boardId: id }),
        trpcClient.label.list.query({ boardId: id }),
      ])
      // Map tRPC member shape { user, role } → BoardMember
      const members: BoardMember[] = rawMembers.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatar_url: m.user.avatar_url ?? undefined,
        role: m.role,
      }))
      set({
        currentBoard: board as Board,
        columns: columns as Column[],
        tasks: tasks as Task[],
        fields: fields as CustomField[],
        members,
        labels: labels as Label[],
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch board'
      set({ error: message, loading: false })
    }
  },

  createBoard: async (name: string, description?: string) => {
    try {
      const board = await trpcClient.board.create.mutate({ name, description }) as Board
      set({ boards: [...get().boards, board] })
      notify(`Board "${name}" created`)
      return board
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create board'
      set({ error: message })
      throw err
    }
  },

  deleteBoard: async (id: string) => {
    const board = get().boards.find((b) => b.id === id)
    try {
      await trpcClient.board.delete.mutate({ boardId: id })
      set({ boards: get().boards.filter((b) => b.id !== id) })
      if (board) notify(`Board "${board.name}" deleted`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete board'
      set({ error: message })
      throw err
    }
  },

  createColumn: async (boardId: string, name: string, color?: string) => {
    const column = await trpcClient.column.create.mutate({ boardId, name, color }) as Column
    set({ columns: [...get().columns, column] })
    notify(`Column "${name}" added`)
    return column
  },

  createTask: async (
    boardId: string,
    columnId: string,
    title: string,
    priority?: string,
  ) => {
    try {
      const task = await trpcClient.task.create.mutate({
        boardId,
        columnId,
        title,
        priority,
      }) as Task
      set({ tasks: [...get().tasks, task] })
      notify(`Task "${title}" created`)
      return task
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
      set({ error: message })
      throw err
    }
  },

  moveTask: async (
    boardId: string,
    taskId: string,
    columnId: string,
    position: number,
  ) => {
    const updated = await trpcClient.task.move.mutate({
      boardId,
      taskId,
      columnId,
      position,
    }) as Task
    set({
      tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
    })
  },

  updateTask: async (
    boardId: string,
    taskId: string,
    data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>,
  ) => {
    const updated = await trpcClient.task.update.mutate({
      boardId,
      taskId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      assignee: data.assignee,
      due_date: data.due_date ?? undefined,
    }) as Task
    set({
      tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
    })
  },

  deleteTask: async (boardId: string, taskId: string) => {
    try {
      await trpcClient.task.delete.mutate({ boardId, taskId })
      set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task'
      set({ error: message })
      throw err
    }
  },

  duplicateTask: async (boardId: string, taskId: string) => {
    const task = await trpcClient.task.duplicate.mutate({ taskId, boardId }) as Task
    // Refetch all tasks to get correct positions after shift
    const tasks = await trpcClient.task.list.query({ boardId }) as Task[]
    set({ tasks })
    notify(`Task "${task.title}" created`)
    return task
  },

  duplicateBoard: async (boardId: string, name: string, includeTasks?: boolean) => {
    const board = await trpcClient.board.duplicate.mutate({
      boardId,
      newName: name,
      includeTasks: includeTasks ?? true,
    }) as Board
    set({ boards: [...get().boards, board] })
    notify(`Board "${board.name}" created`)
    return board
  },

  createLabel: async (boardId: string, name: string, color: string) => {
    const label = await trpcClient.label.create.mutate({ boardId, name, color }) as Label
    set({ labels: [...get().labels, label] })
    return label
  },

  updateLabel: async (boardId: string, labelId: string, data: { name?: string; color?: string }) => {
    await trpcClient.label.update.mutate({ boardId, labelId, ...data })
    set({
      labels: get().labels.map((l) =>
        l.id === labelId ? { ...l, ...data } : l,
      ),
    })
  },

  deleteLabel: async (boardId: string, labelId: string) => {
    await trpcClient.label.delete.mutate({ boardId, labelId })
    set({ labels: get().labels.filter((l) => l.id !== labelId) })
  },

  addTaskLabel: async (boardId: string, taskId: string, labelId: string) => {
    await trpcClient.label.addToTask.mutate({ boardId, taskId, labelId })
    const label = get().labels.find((l) => l.id === labelId)
    if (!label) return
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, labels: [...(t.labels ?? []), label] }
          : t,
      ),
    })
  },

  removeTaskLabel: async (boardId: string, taskId: string, labelId: string) => {
    await trpcClient.label.removeFromTask.mutate({ boardId, taskId, labelId })
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, labels: (t.labels ?? []).filter((l) => l.id !== labelId) }
          : t,
      ),
    })
  },

  archiveTask: async (boardId: string, taskId: string) => {
    await trpcClient.archive.archiveTask.mutate({ boardId, taskId })
    set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
    notify('Task archived')
  },

  unarchiveTask: async (boardId: string, taskId: string) => {
    await trpcClient.archive.unarchiveTask.mutate({ boardId, taskId })
    await get().fetchBoard(boardId)
    notify('Task restored')
  },

  updateColumn: async (boardId: string, columnId: string, data: { name?: string; color?: string | null }) => {
    await trpcClient.column.update.mutate({
      boardId,
      columnId,
      name: data.name,
      color: data.color,
    })
    const patch: Partial<Column> = { ...data, color: data.color ?? undefined }
    set({
      columns: get().columns.map((c) =>
        c.id === columnId ? { ...c, ...patch } : c,
      ),
    })
  },

  deleteColumn: async (boardId: string, columnId: string) => {
    const column = get().columns.find((c) => c.id === columnId)
    await trpcClient.column.delete.mutate({ boardId, columnId })
    set({
      columns: get().columns.filter((c) => c.id !== columnId),
      tasks: get().tasks.filter((t) => t.column_id !== columnId),
    })
    if (column) notify(`Column "${column.name}" deleted`)
  },

  moveColumn: async (boardId: string, columnId: string, position: number) => {
    await trpcClient.column.move.mutate({ boardId, columnId, position })
    await get().fetchBoard(boardId)
  },

  archiveColumn: async (boardId: string, columnId: string) => {
    const column = get().columns.find((c) => c.id === columnId)
    await trpcClient.column.archive.mutate({ boardId, columnId })
    set({
      columns: get().columns.filter((c) => c.id !== columnId),
      tasks: get().tasks.filter((t) => t.column_id !== columnId),
    })
    if (column) notify(`Column "${column.name}" archived`)
  },

  unarchiveColumn: async (boardId: string, columnId: string) => {
    await trpcClient.column.unarchive.mutate({ boardId, columnId })
    await get().fetchBoard(boardId)
    notify('Column restored')
  },

  clearCurrentBoard: () => {
    set({ currentBoard: null, columns: [], tasks: [], fields: [], members: [], labels: [] })
  },
}))
