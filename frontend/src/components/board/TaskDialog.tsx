import type { Task, AgentSession } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TaskEditor } from './TaskEditor'

interface TaskDialogProps {
  task: Task | null
  open: boolean
  onClose: () => void
  onOpenTerminal?: (session: AgentSession) => void
}

export function TaskDialog({ task, open, onClose, onOpenTerminal }: TaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{task?.title ?? 'Task'}</DialogTitle>
          <DialogDescription>Task details</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
          {task && <TaskEditor task={task} onClose={onClose} onOpenTerminal={onOpenTerminal} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
