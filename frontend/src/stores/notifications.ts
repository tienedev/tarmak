import { create } from 'zustand'

export interface Notification {
  id: string
  message: string
  timestamp: number
  read: boolean
}

interface NotificationState {
  notifications: Notification[]
  add: (message: string) => void
  markRead: (id: string) => void
  markAllRead: () => void
  dismiss: (id: string) => void
  unreadCount: () => number
}

let nextId = 0

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  add: (message: string) => {
    const notification: Notification = {
      id: `notif-${++nextId}-${Date.now()}`,
      message,
      timestamp: Date.now(),
      read: false,
    }
    set({ notifications: [notification, ...get().notifications].slice(0, 50) })
  },

  markRead: (id: string) => {
    set({
      notifications: get().notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })
  },

  markAllRead: () => {
    set({
      notifications: get().notifications.map((n) => ({ ...n, read: true })),
    })
  },

  dismiss: (id: string) => {
    set({
      notifications: get().notifications.filter((n) => n.id !== id),
    })
  },

  unreadCount: () => get().notifications.filter((n) => !n.read).length,
}))
