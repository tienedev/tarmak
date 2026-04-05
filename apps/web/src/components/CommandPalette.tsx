import {
  CommandDialog, Command, CommandInput, CommandList,
  CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Kanban, List, GanttChart, History, Keyboard } from 'lucide-react'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: string) => void
}

export function CommandPalette({ open, onOpenChange, onAction }: CommandPaletteProps) {
  const { t } = useTranslation()
  function run(action: string) {
    onAction(action)
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder={t('commandPalette.placeholder')} />
        <CommandList>
          <CommandEmpty>{t('common.noResults')}</CommandEmpty>
          <CommandGroup heading={t('commandPalette.tasks')}>
            <CommandItem onSelect={() => run('create-task')}>
              <Plus className="size-4" />
              {t('commandPalette.createTask')}
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('commandPalette.navigation')}>
            <CommandItem onSelect={() => run('search')}>
              <Search className="size-4" />
              {t('commandPalette.search')}
              <CommandShortcut>/</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('commandPalette.views')}>
            <CommandItem onSelect={() => run('view-kanban')}>
              <Kanban className="size-4" /> {t('commandPalette.kanbanView')} <CommandShortcut>1</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-list')}>
              <List className="size-4" /> {t('commandPalette.listView')} <CommandShortcut>2</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-timeline')}>
              <GanttChart className="size-4" /> {t('commandPalette.timelineView')} <CommandShortcut>3</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('commandPalette.board')}>
            <CommandItem onSelect={() => run('activity')}>
              <History className="size-4" /> {t('commandPalette.activity')} <CommandShortcut>A</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('shortcuts')}>
              <Keyboard className="size-4" /> {t('commandPalette.shortcuts')} <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
