import type { AgentSession } from '@/lib/api'
import { Check, X } from 'lucide-react'

interface SessionIndicatorProps {
  session: AgentSession | undefined
}

export function SessionIndicator({ session }: SessionIndicatorProps) {
  if (!session) return null

  switch (session.status) {
    case 'running':
      return (
        <span className="relative flex h-2.5 w-2.5" title="Agent running">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>
      )
    case 'success':
      return <Check className="size-3.5 text-green-500" />
    case 'failed':
      return <X className="size-3.5 text-red-500" />
    case 'cancelled':
      return <X className="size-3.5 text-zinc-400" />
    default:
      return null
  }
}
