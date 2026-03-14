import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Board, Column, Task, CustomField, BoardMember } from '@/lib/api'
import { useNotificationStore } from './notifications'

interface BoardState {
  boards: Board[]
  currentBoard: Board | null
  columns: Column[]
  tasks: Task[]
  fields: CustomField[]
  members: BoardMember[]
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
      const [board, columns, tasks, fields, members] = await Promise.all([
        api.getBoard(id),
        api.listColumns(id),
        api.listTasks(id),
        api.listFields(id),
        api.listMembers(id),
      ])
      set({ currentBoard: board, columns, tasks, fields, members, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch board'
      set({ error: message, loading: false })
    }
  },

  createBoard: async (name: string, description?: string) => {
    const board = await api.createBoard({ name, description })
    set({ boards: [...get().boards, board] })
    notify(`Board "${name}" created`)
    return board
  },

  deleteBoard: async (id: string) => {
    const board = get().boards.find((b) => b.id === id)
    await api.deleteBoard(id)
    set({ boards: get().boards.filter((b) => b.id !== id) })
    if (board) notify(`Board "${board.name}" deleted`)
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
    const task = await api.createTask(boardId, {
      column_id: columnId,
      title,
      priority,
    })
    set({ tasks: [...get().tasks, task] })
    notify(`Task "${title}" created`)
    return task
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
    await api.deleteTask(boardId, taskId)
    set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
  },

  clearCurrentBoard: () => {
    set({ currentBoard: null, columns: [], tasks: [], fields: [], members: [] })
  },
}))
