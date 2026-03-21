import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'

const shortcuts = [
  { key: '⌘ K', descriptionKey: 'shortcuts.commandPalette' },
  { key: 'N', descriptionKey: 'shortcuts.createTask' },
  { key: '/', descriptionKey: 'shortcuts.search' },
  { key: '1', descriptionKey: 'shortcuts.kanbanView' },
  { key: '2', descriptionKey: 'shortcuts.listView' },
  { key: '3', descriptionKey: 'shortcuts.timelineView' },
  { key: 'A', descriptionKey: 'shortcuts.activityPanel' },
  { key: '?', descriptionKey: 'shortcuts.keyboardShortcuts' },
]

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t(s.descriptionKey)}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">{s.key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
