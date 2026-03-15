import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArchiveRestore } from 'lucide-react'
import { api, type Task, type Column } from '@/lib/api'
import { useBoardStore } from '@/stores/board'

interface ArchivePanelProps {
  boardId: string
  open: boolean
  onClose: () => void
}

export function ArchivePanel({ boardId, open, onClose }: ArchivePanelProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.listArchived(boardId)
      .then(({ tasks, columns }) => { setTasks(tasks); setColumns(columns) })
      .finally(() => setLoading(false))
  }, [open, boardId])

  async function restoreTask(taskId: string) {
    await useBoardStore.getState().unarchiveTask(boardId, taskId)
    setTasks(tasks.filter(t => t.id !== taskId))
  }

  async function restoreColumn(columnId: string) {
    await useBoardStore.getState().unarchiveColumn(boardId, columnId)
    setColumns(columns.filter(c => c.id !== columnId))
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-[380px]">
        <SheetHeader className="shrink-0 pb-3">
          <SheetTitle className="text-base">Archives</SheetTitle>
          <SheetDescription className="sr-only">Archived tasks and columns</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : tasks.length === 0 && columns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No archived items</p>
          ) : (
            <div className="flex flex-col gap-4 pr-3">
              {columns.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold text-muted-foreground">Columns</h3>
                  <div className="flex flex-col gap-1">
                    {columns.map(c => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span>{c.name}</span>
                        <Button variant="ghost" size="icon-xs" onClick={() => restoreColumn(c.id)}>
                          <ArchiveRestore className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tasks.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold text-muted-foreground">Tasks</h3>
                  <div className="flex flex-col gap-1">
                    {tasks.map(t => (
                      <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span className="truncate">{t.title}</span>
                        <Button variant="ghost" size="icon-xs" onClick={() => restoreTask(t.id)}>
                          <ArchiveRestore className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
