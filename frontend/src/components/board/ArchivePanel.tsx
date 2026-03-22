import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DrawerLayout } from '@/components/ui/drawer-layout'
import { Button } from '@/components/ui/button'
import { ArchiveRestore } from 'lucide-react'
import { api, type Task, type Column } from '@/lib/api'
import { useBoardStore } from '@/stores/board'

interface ArchivePanelProps {
  boardId: string
  open: boolean
  onClose: () => void
}

export function ArchivePanel({ boardId, open, onClose }: ArchivePanelProps) {
  const { t } = useTranslation()
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
    <DrawerLayout open={open} onClose={onClose} title={t('archives.title')}>
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : tasks.length === 0 && columns.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('archives.noArchived')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {columns.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-bold text-muted-foreground">{t('archives.columns')}</h3>
              <div className="flex flex-col gap-1.5">
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
              <h3 className="mb-2 text-xs font-bold text-muted-foreground">{t('archives.tasks')}</h3>
              <div className="flex flex-col gap-1.5">
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
    </DrawerLayout>
  )
}
