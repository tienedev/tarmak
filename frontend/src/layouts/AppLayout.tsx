import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import { ThemeSelector } from '@/components/settings/ThemeSelector'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Kanban,
  Menu,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const boards = useBoardStore((s) => s.boards)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const [sidebarOpen, setSidebarOpen] = useState(false)

  const sidebarContent = (
    <>
      {/* Logo area */}
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Kanban className="size-4" />
        </div>
        <span className="text-sm font-bold tracking-tight">
          Kanwise
        </span>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* Navigation */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <span className="px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Boards
          </span>
        </div>

        <ScrollArea className="flex-1 px-3">
          <nav className="flex flex-col gap-0.5 py-1">
            {boards.map((board) => (
              <a
                key={board.id}
                href={`#/boards/${board.id}`}
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/75 transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-sm"
              >
                <LayoutDashboard className="size-3.5 shrink-0 opacity-50" />
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
              setSidebarOpen(false)
            }}
          >
            <Plus className="size-3.5" />
            New Board
          </Button>
        </div>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* User area */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary uppercase">
            {user?.name?.charAt(0) ?? '?'}
          </div>
          <span className="truncate text-xs font-medium">
            {user?.name ?? 'Guest'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationBell />
          <ThemeSelector />
          <Button variant="ghost" size="icon-xs" onClick={logout} aria-label="Sign out">
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col glass glass-border text-sidebar-foreground">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-0 text-sidebar-foreground" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header with hamburger */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 md:hidden glass-heavy glass-border">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </Button>
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Kanban className="size-3.5" />
          </div>
          <span className="text-sm font-bold tracking-tight">Kanwise</span>
        </div>

        {children}
      </main>
    </div>
  )
}
