import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'
import { Plus, LayoutDashboard, Loader2 } from 'lucide-react'

export function BoardsListPage() {
  const { boards, loading, fetchBoards, createBoard } = useBoardStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const board = await createBoard(newName.trim(), newDesc.trim() || undefined)
      setNewName('')
      setNewDesc('')
      setDialogOpen(false)
      window.location.hash = `#/boards/${board.id}`
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <h1 className="text-sm font-semibold">All Boards</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="size-3.5" data-icon="inline-start" />
                New Board
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Board</DialogTitle>
              <DialogDescription>
                Add a new board to organize your tasks.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="board-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Name
                </label>
                <Input
                  id="board-name"
                  placeholder="e.g. Product Roadmap"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="board-desc"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Description{' '}
                  <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                  id="board-desc"
                  placeholder="What is this board for?"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={creating || !newName.trim()}>
                  {creating ? 'Creating...' : 'Create Board'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {/* Content */}
      <div className="flex-1 p-6">
        {loading && boards.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <LayoutDashboard className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No boards yet</p>
              <p className="text-xs text-muted-foreground">
                Create your first board to get started.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="size-3.5" data-icon="inline-start" />
              Create Board
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {boards.map((board) => (
              <a
                key={board.id}
                href={`#/boards/${board.id}`}
                className="block transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <Card className="h-full cursor-pointer transition-shadow hover:ring-2 hover:ring-ring/20">
                  <CardHeader>
                    <CardTitle>{board.name}</CardTitle>
                    {board.description && (
                      <CardDescription className="line-clamp-2">
                        {board.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
