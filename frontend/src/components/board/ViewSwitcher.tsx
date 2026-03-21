import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Columns3, List, GanttChart } from 'lucide-react'

export type ViewMode = 'kanban' | 'list' | 'timeline' | 'sessions'

interface ViewSwitcherProps {
  value: ViewMode
  onChange: (value: ViewMode) => void
}

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        if (v === 'kanban' || v === 'list' || v === 'timeline') {
          onChange(v)
        }
      }}
    >
      <TabsList variant="line">
        <TabsTrigger value="kanban">
          <Columns3 className="size-3.5" />
          Board
        </TabsTrigger>
        <TabsTrigger value="list">
          <List className="size-3.5" />
          List
        </TabsTrigger>
        <TabsTrigger value="timeline">
          <GanttChart className="size-3.5" />
          Timeline
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
