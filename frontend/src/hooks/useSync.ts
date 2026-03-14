import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { createSyncProvider } from '@/lib/sync'
import { useAuthStore } from '@/stores/auth'

interface SyncState {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  connected: boolean
}

export function useSync(boardId: string | null): SyncState {
  const [connected, setConnected] = useState(false)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const docRef = useRef<Y.Doc | null>(null)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!boardId) return

    const { doc, provider } = createSyncProvider(boardId, token)
    docRef.current = doc
    providerRef.current = provider

    if (!provider) {
      return () => {
        doc.destroy()
        docRef.current = null
      }
    }

    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === 'connected')
    }

    provider.on('status', onStatus)

    return () => {
      provider.off('status', onStatus)
      provider.destroy()
      doc.destroy()
      docRef.current = null
      providerRef.current = null
      setConnected(false)
    }
  }, [boardId, token])

  return {
    doc: docRef.current,
    provider: providerRef.current,
    connected,
  }
}
