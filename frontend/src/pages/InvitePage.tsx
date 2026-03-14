import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Check, Loader2, X } from 'lucide-react'

interface InvitePageProps {
  token: string
}

export function InvitePage({ token }: InvitePageProps) {
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleAccept = async () => {
    if (!user) return
    setStatus('loading')
    try {
      await api.acceptInvite({ invite_token: token })
      setStatus('success')
      setTimeout(() => { window.location.hash = '#/' }, 1500)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Failed to accept invite')
    }
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            You need to be logged in to accept this invitation.
          </p>
          <Button onClick={() => { window.location.hash = '#/login' }}>
            Go to login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Board Invitation</h1>

        {status === 'idle' && (
          <>
            <p className="text-sm text-muted-foreground">
              You've been invited to join a board.
            </p>
            <Button onClick={handleAccept}>Accept invitation</Button>
          </>
        )}

        {status === 'loading' && (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-2">
            <Check className="size-8 text-green-500" />
            <p className="text-sm text-muted-foreground">
              You've joined the board! Redirecting...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-2">
            <X className="size-8 text-red-500" />
            <p className="text-sm text-red-500">{error}</p>
            <Button variant="outline" onClick={() => { window.location.hash = '#/' }}>
              Go to boards
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
