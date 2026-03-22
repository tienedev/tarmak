import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { setLanguage } from '@/i18n'
import {
  type ThemeMode,
  type AccentTheme,
  accentThemes,
  getStoredMode,
  getStoredAccent,
  storeMode,
  storeAccent,
  applyThemeMode,
  applyAccentTheme,
} from '@/lib/themes'
import {
  LayoutDashboard,
  Plus,
  LogOut,
  Kanban,
  Menu,
  Sun,
  Moon,
  Monitor,
  Globe,
  Palette,
  Check,
  Settings2,
  Terminal,
  ChevronRight,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface AppLayoutProps {
  children: ReactNode
}

function useCurrentRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  const boardMatch = hash.match(/^#\/boards\/([^?/]+)/)
  const devgroundMatch = hash.match(/^#\/boards\/([^/]+)\/devground/)
  return {
    activeBoardId: boardMatch?.[1] ?? devgroundMatch?.[1] ?? null,
    isDevGround: !!devgroundMatch,
  }
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation()
  const boards = useBoardStore((s) => s.boards)
  const createBoard = useBoardStore((s) => s.createBoard)
  const { activeBoardId, isDevGround } = useCurrentRoute()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set())

  // Auto-expand active board
  useEffect(() => {
    if (activeBoardId) {
      setExpandedBoards((prev) => {
        if (prev.has(activeBoardId)) return prev
        return new Set(prev).add(activeBoardId)
      })
    }
  }, [activeBoardId])

  const toggleExpand = (boardId: string) => {
    setExpandedBoards((prev) => {
      const next = new Set(prev)
      if (next.has(boardId)) next.delete(boardId)
      else next.add(boardId)
      return next
    })
  }

  const handleCreateBoard = async () => {
    if (!newBoardName.trim() || creating) return
    setCreating(true)
    try {
      const board = await createBoard(newBoardName.trim())
      setCreateOpen(false)
      setNewBoardName('')
      setSidebarOpen(false)
      window.location.hash = `#/boards/${board.id}`
    } catch {
      // error handled by store
    } finally {
      setCreating(false)
    }
  }

  const sidebarContent = (
    <>
      {/* Logo area */}
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Kanban className="size-4" />
        </div>
        <span className="text-sm font-bold tracking-tight">
          Tarmak
        </span>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* Navigation */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <span className="px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('sidebar.boards')}
          </span>
        </div>

        <ScrollArea className="flex-1 px-3">
          <nav className="flex flex-col gap-0.5 py-1">
            {boards.map((board) => {
              const isExpanded = expandedBoards.has(board.id)
              const isActive = activeBoardId === board.id
              return (
                <div key={board.id}>
                  {/* Board name — expandable */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(board.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                      isActive ? 'text-sidebar-foreground font-medium' : 'text-sidebar-foreground/75'
                    }`}
                  >
                    <ChevronRight className={`size-3 shrink-0 opacity-50 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    <span className="truncate">{board.name}</span>
                  </button>

                  {/* Sub-items */}
                  {isExpanded && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border/40 pl-2 py-0.5">
                      <a
                        href={`#/boards/${board.id}`}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                          isActive && !isDevGround
                            ? 'bg-sidebar-accent/50 text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground/60'
                        }`}
                      >
                        <LayoutDashboard className="size-3 shrink-0" />
                        {t('sidebar.board')}
                      </a>
                      <a
                        href={`#/boards/${board.id}/devground`}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                          isActive && isDevGround
                            ? 'bg-sidebar-accent/50 text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground/60'
                        }`}
                      >
                        <Terminal className="size-3 shrink-0" />
                        {t('sidebar.devGround')}
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
            {boards.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {t('sidebar.noBoards')}
              </p>
            )}
          </nav>
        </ScrollArea>

        <div className="px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            {t('sidebar.newBoard')}
          </Button>
        </div>
      </div>

      <div className="mx-3 h-px bg-border/60" />

      {/* User area */}
      <div className="flex items-center justify-between px-4 py-3">
        <UserMenu />
        <NotificationBell />
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
            <SheetTitle>{t('sidebar.navigation')}</SheetTitle>
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
            aria-label={t('sidebar.navigation')}
          >
            <Menu className="size-4" />
          </Button>
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Kanban className="size-3.5" />
          </div>
          <span className="text-sm font-bold tracking-tight">Tarmak</span>
        </div>

        {children}
      </main>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('sidebar.newBoard')}</DialogTitle>
          </DialogHeader>
          <Input
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBoard() }}
            placeholder={t('board.boardName')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleCreateBoard} disabled={!newBoardName.trim() || creating}>
              {creating ? t('common.creating') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const languages = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
]

const modeOptions: { value: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
]

function UserMenu() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [accent, setAccent] = useState<string>(getStoredAccent)

  useEffect(() => {
    storeMode(mode)
    applyThemeMode(mode)
  }, [mode])

  useEffect(() => {
    storeAccent(accent)
    applyAccentTheme(accent)
  }, [accent])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 overflow-hidden rounded-lg px-1 py-1 -mx-1 transition-colors hover:bg-sidebar-accent"
          />
        }
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary uppercase">
          {user?.name?.charAt(0) ?? '?'}
        </div>
        <span className="truncate text-xs font-medium">
          {user?.name ?? 'Guest'}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        {/* User info */}
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>

        <DropdownMenuSeparator />

        {/* Language sub-menu */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Globe className="size-3.5" />
              {t('settings.language')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {languages.map((lang) => (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                >
                  <span>{lang.flag}</span>
                  <span>{lang.label}</span>
                  {i18n.language === lang.code && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        {/* Theme sub-menu */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette className="size-3.5" />
              {t('theme.mode')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {modeOptions.map((opt) => {
                const Icon = opt.icon
                return (
                  <DropdownMenuItem key={opt.value} onClick={() => setMode(opt.value)}>
                    <Icon className="size-3.5" />
                    {t(opt.labelKey)}
                    {mode === opt.value && <Check className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('theme.accent')}</DropdownMenuLabel>
              <div className="flex gap-1.5 px-2 py-1.5">
                {accentThemes.map((theme: AccentTheme) => (
                  <button
                    key={theme.name}
                    type="button"
                    onClick={() => setAccent(theme.name)}
                    className={`flex size-6 items-center justify-center rounded-full transition-all ${accent === theme.name ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : ''}`}
                    title={theme.label}
                  >
                    <span
                      className="size-4 rounded-full shadow-sm"
                      style={{ backgroundColor: theme.preview }}
                    />
                  </button>
                ))}
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Settings */}
        <DropdownMenuItem onClick={() => (window.location.hash = '#/settings')}>
          <Settings2 className="size-3.5" />
          {t('userSettings.settings')}
        </DropdownMenuItem>

        {/* Sign out */}
        <DropdownMenuItem onClick={logout}>
          <LogOut className="size-3.5" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
