import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import { ThemeSelector } from '@/components/settings/ThemeSelector'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Kanban,
} from 'lucide-react'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const boards = useBoardStore((s) => s.boards)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        {/* Logo area */}
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Kanban className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            Optimized Kanban
          </span>
        </div>

        <Separator />

        {/* Navigation */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-1">
            <span className="px-1 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Boards
            </span>
          </div>

          <ScrollArea className="flex-1 px-3">
            <nav className="flex flex-col gap-0.5 py-1">
              {boards.map((board) => (
                <a
                  key={board.id}
                  href={`#/boards/${board.id}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <LayoutDashboard className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{board.name}</span>
                </a>
              ))}
              {boards.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No boards yet
                </p>
              )}
            </nav>
          </ScrollArea>

          <div className="px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                window.location.hash = '#/'
              }}
            >
              <Plus className="size-3.5" />
              New Board
            </Button>
          </div>
        </div>

        <Separator />

        {/* User area with theme/notifications */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
              {user?.name?.charAt(0) ?? '?'}
            </div>
            <span className="truncate text-xs font-medium">
              {user?.name ?? 'Guest'}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <NotificationBell />
            <ThemeSelector />
            <Button variant="ghost" size="icon-xs" onClick={logout}>
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}
