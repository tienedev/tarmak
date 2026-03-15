import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Board, Column, Task, CustomField, BoardMember, Label } from '@/lib/api'
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
      const boards = await api.listBoards()
      set({ boards, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch boards'
      set({ error: message, loading: false })
    }
  },

  fetchBoard: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const [board, columns, tasks, fields, members, labels] = await Promise.all([
        api.getBoard(id),
        api.listColumns(id),
        api.listTasks(id),
        api.listFields(id),
        api.listMembers(id),
        api.listLabels(id),
      ])
      set({ currentBoard: board, columns, tasks, fields, members, labels, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch board'
      set({ error: message, loading: false })
    }
  },

  createBoard: async (name: string, description?: string) => {
    try {
      const board = await api.createBoard({ name, description })
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
      await api.deleteBoard(id)
      set({ boards: get().boards.filter((b) => b.id !== id) })
      if (board) notify(`Board "${board.name}" deleted`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete board'
      set({ error: message })
      throw err
    }
  },

  createColumn: async (boardId: string, name: string, color?: string) => {
    const column = await api.createColumn(boardId, { name, color })
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
      const task = await api.createTask(boardId, {
        column_id: columnId,
        title,
        priority,
      })
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
    const updated = await api.moveTask(boardId, taskId, {
      column_id: columnId,
      position,
    })
    set({
      tasks: get().tasks.map((t) => (t.id === taskId ? updated : t)),
    })
  },

  updateTask: async (
    boardId: string,
    taskId: string,
    data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>,
  ) => {
    const updated = await api.updateTask(boardId, taskId, data)
    set({
      tasks: get().tasks.map((t) => (t.id === taskId ? updated : t)),
    })
  },

  deleteTask: async (boardId: string, taskId: string) => {
    try {
      await api.deleteTask(boardId, taskId)
      set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task'
      set({ error: message })
      throw err
    }
  },

  createLabel: async (boardId: string, name: string, color: string) => {
    const label = await api.createLabel(boardId, { name, color })
    set({ labels: [...get().labels, label] })
    return label
  },

  updateLabel: async (boardId: string, labelId: string, data: { name?: string; color?: string }) => {
    await api.updateLabel(boardId, labelId, data)
    set({
      labels: get().labels.map((l) =>
        l.id === labelId ? { ...l, ...data } : l,
      ),
    })
  },

  deleteLabel: async (boardId: string, labelId: string) => {
    await api.deleteLabel(boardId, labelId)
    set({ labels: get().labels.filter((l) => l.id !== labelId) })
  },

  addTaskLabel: async (boardId: string, taskId: string, labelId: string) => {
    await api.addTaskLabel(boardId, taskId, labelId)
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
    await api.removeTaskLabel(boardId, taskId, labelId)
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, labels: (t.labels ?? []).filter((l) => l.id !== labelId) }
          : t,
      ),
    })
  },

  clearCurrentBoard: () => {
    set({ currentBoard: null, columns: [], tasks: [], fields: [], members: [], labels: [] })
  },
}))
