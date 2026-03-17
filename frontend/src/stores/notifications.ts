import { create } from 'zustand'
import type { ServerNotification } from '@/lib/api'
import { api } from '@/lib/api'

interface NotificationState {
  notifications: ServerNotification[]
  unreadCount: number
  loading: boolean
  eventSource: EventSource | null

  // Backend-synced actions
  fetch: () => Promise<void>
  fetchUnreadCount: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismiss: (id: string) => void
  connectSSE: () => void
  disconnectSSE: () => void

  // Client-only toast (kept for backward compat with ~30 callers)
  add: (message: string) => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  eventSource: null,

  fetch: async () => {
    set({ loading: true })
    try {
      const notifs = await api.listNotifications({ limit: 50 })
      set({ notifications: notifs, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchUnreadCount: async () => {
    try {
      const { count } = await api.getUnreadCount()
      set({ unreadCount: count })
    } catch {
      // ignore
    }
  },

  markRead: async (id: string) => {
    try {
      await api.markNotificationRead(id)
      set({
        notifications: get().notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
        unreadCount: Math.max(0, get().unreadCount - 1),
      })
    } catch {
      // ignore
    }
  },

  markAllRead: async () => {
    try {
      await api.markAllNotificationsRead()
      set({
        notifications: get().notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      })
    } catch {
      // ignore
    }
  },

  dismiss: (id: string) => {
    // Client-side only removal (maps to mark-as-read conceptually)
    const notif = get().notifications.find((n) => n.id === id)
    if (notif && !notif.read) {
      api.markNotificationRead(id).catch(() => {})
    }
    set({
      notifications: get().notifications.filter((n) => n.id !== id),
      unreadCount: notif && !notif.read ? Math.max(0, get().unreadCount - 1) : get().unreadCount,
    })
  },

  connectSSE: () => {
    get().disconnectSSE()
    api.getStreamTicket().then(({ ticket }) => {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const es = new EventSource(`${baseUrl}/api/v1/notifications/stream?ticket=${ticket}`)
      es.addEventListener('notification', (event) => {
        const notif: ServerNotification = JSON.parse(event.data)
        set({
          notifications: [notif, ...get().notifications].slice(0, 50),
          unreadCount: get().unreadCount + 1,
        })
      })
      es.onerror = () => {
        // EventSource auto-reconnects, but we need a new ticket
        es.close()
        // Retry after 5 seconds
        setTimeout(() => get().connectSSE(), 5000)
      }
      set({ eventSource: es })
    }).catch(() => {
      // Fallback: poll every 30s
      const poll = setInterval(() => get().fetchUnreadCount(), 30000)
      set({ eventSource: { close: () => clearInterval(poll) } as unknown as EventSource })
    })
  },

  disconnectSSE: () => {
    const es = get().eventSource
    if (es) {
      es.close()
      set({ eventSource: null })
    }
  },

  // Client-only toast method — backward compat for ~30 callers across the app.
  // These are UI feedback messages (e.g. "Label created"), not server notifications.
  add: (message: string) => {
    const toast: ServerNotification = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: '',
      board_id: '',
      task_id: null,
      type: 'comment',
      title: message,
      body: null,
      read: false,
      created_at: new Date().toISOString(),
    }
    set({
      notifications: [toast, ...get().notifications].slice(0, 50),
      unreadCount: get().unreadCount + 1,
    })
  },
}))
