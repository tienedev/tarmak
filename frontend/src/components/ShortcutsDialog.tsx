import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

const shortcuts = [
  { key: '⌘ K', description: 'Command palette' },
  { key: 'N', description: 'Create task' },
  { key: '/', description: 'Search' },
  { key: '1', description: 'Kanban view' },
  { key: '2', description: 'List view' },
  { key: '3', description: 'Timeline view' },
  { key: 'A', description: 'Activity panel' },
  { key: '?', description: 'Keyboard shortcuts' },
]

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Quick actions for navigating Kanwise</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">{s.key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
