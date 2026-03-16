import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export function createSyncProvider(boardId: string, token: string | null) {
  const doc = new Y.Doc()

  if (!token) {
    return { doc, provider: null }
  }

  // In dev, connect directly to the backend to avoid Vite proxy noise (ECONNRESET).
  // In production, the backend serves everything on the same origin.
  const wsBase = import.meta.env.DEV
    ? 'ws://localhost:3001'
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

  const provider = new WebsocketProvider(`${wsBase}/ws/boards`, boardId, doc, {
    params: { token },
    maxBackoffTime: 30_000,
  })
  return { doc, provider }
}
