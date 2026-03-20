import { useEffect, useState, useCallback } from 'react'
import type { WebsocketProvider } from 'y-websocket'

export interface PresenceUser {
  id: number
  name: string
  color: string
}

// Deterministic color palette from user ID
const PRESENCE_PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
]

function colorForId(id: number): string {
  return PRESENCE_PALETTE[Math.abs(id) % PRESENCE_PALETTE.length]
}

export function usePresence(
  provider: WebsocketProvider | null,
  userName: string,
): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([])

  const updateUsers = useCallback(() => {
    if (!provider) return

    const awareness = provider.awareness
    const states = awareness.getStates()
    const result: PresenceUser[] = []

    states.forEach((state, clientId) => {
      if (state.user) {
        result.push({
          id: clientId,
          name: state.user.name as string,
          color: state.user.color as string,
        })
      }
    })

    setUsers(result)
  }, [provider])

  useEffect(() => {
    if (!provider) return

    const awareness = provider.awareness
    const localId = awareness.clientID

    // Set local user state
    awareness.setLocalStateField('user', {
      name: userName,
      color: colorForId(localId),
    })

    // Listen for changes
    const onChange = () => updateUsers()
    awareness.on('change', onChange)

    // Initial population
    updateUsers()

    return () => {
      awareness.off('change', onChange)
      awareness.setLocalStateField('user', null)
    }
  }, [provider, userName, updateUsers])

  return users
}
