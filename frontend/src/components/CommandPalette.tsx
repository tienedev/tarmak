import {
  CommandDialog, Command, CommandInput, CommandList,
  CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command'
import { Plus, Search, Kanban, List, GanttChart, History, Keyboard } from 'lucide-react'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: string) => void
}

export function CommandPalette({ open, onOpenChange, onAction }: CommandPaletteProps) {
  function run(action: string) {
    onAction(action)
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder="Type a command..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Tasks">
            <CommandItem onSelect={() => run('create-task')}>
              <Plus className="size-4" />
              Create task
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => run('search')}>
              <Search className="size-4" />
              Search
              <CommandShortcut>/</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Views">
            <CommandItem onSelect={() => run('view-kanban')}>
              <Kanban className="size-4" /> Kanban view <CommandShortcut>1</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-list')}>
              <List className="size-4" /> List view <CommandShortcut>2</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-timeline')}>
              <GanttChart className="size-4" /> Timeline view <CommandShortcut>3</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Board">
            <CommandItem onSelect={() => run('activity')}>
              <History className="size-4" /> Activity <CommandShortcut>A</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('shortcuts')}>
              <Keyboard className="size-4" /> Keyboard shortcuts <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
