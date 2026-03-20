import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useBoardStore } from '@/stores/board'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { BoardPage } from '@/pages/BoardPage'
import { InvitePage } from '@/pages/InvitePage'
import { Loader2 } from 'lucide-react'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')

  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return hash
}

function Router() {
  const hash = useHashRoute()
  const fetchBoards = useBoardStore((s) => s.fetchBoards)

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  // Route: #/invite/:token
  const inviteMatch = hash.match(/^#\/invite\/(.+)$/)
  if (inviteMatch) {
    return <InvitePage token={inviteMatch[1]} />
  }

  // Route: #/boards/:id
  const boardMatch = hash.match(/^#\/boards\/([^?]+)/)
  if (boardMatch) {
    return (
      <AppLayout>
        <BoardPage boardId={boardMatch[1]} />
      </AppLayout>
    )
  }

  // Route: #/ (default - boards list)
  return (
    <AppLayout>
      <DashboardPage />
    </AppLayout>
  )
}

export default function App() {
  const { user, loading, init } = useAuthStore()
  const hash = useHashRoute()

  useEffect(() => {
    init()
  }, [init])

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Show login page if not authenticated or on login route
  if (!user || hash === '#/login') {
    return <LoginPage />
  }

  return <Router />
}
