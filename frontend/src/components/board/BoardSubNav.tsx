import { useMemo } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBoardStore } from '@/stores/board'
import { useFilterStore } from '@/hooks/useFilters'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Columns3, List, GanttChart, Filter, X, ChevronDown } from 'lucide-react'
import type { ViewMode } from '@/components/board/ViewSwitcher'

const priorityOptions = [
  { value: 'urgent', label: 'Urgent', color: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'bg-zinc-400' },
  { value: 'none', label: 'None', color: 'bg-zinc-300' },
]

interface BoardSubNavProps {
  view: ViewMode
  onViewChange: (v: ViewMode) => void
}

export function BoardSubNav({ view, onViewChange }: BoardSubNavProps) {
  const { columns, members } = useBoardStore()
  const { filters, toggleFilter, clearFilter, clearAll, hasActiveFilters } = useFilterStore()
  const isActive = hasActiveFilters()

  const assignees = useMemo(() => {
    return Array.isArray(members) ? members.map((m) => m.name).sort() : []
  }, [members])

  const activeFilterCount =
    filters.priority.length + filters.assignee.length + filters.column.length

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b px-6">
      {/* View switcher */}
      <Tabs
        value={view}
        onValueChange={(v) => {
          if (v === 'kanban' || v === 'list' || v === 'timeline') {
            onViewChange(v)
          }
        }}
      >
        <TabsList variant="default">
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

      {/* Separator */}
      <div className="h-4 w-px bg-border" />

      {/* Filters */}
      <div className="flex items-center gap-1 text-muted-foreground">
        <Filter className="size-3.5" />
      </div>

      <FilterDropdown
        label="Priority"
        selected={filters.priority}
        options={priorityOptions.map((p) => ({
          value: p.value,
          label: p.label,
          leading: (
            <span className={cn('inline-block size-2 rounded-full', p.color)} />
          ),
        }))}
        onToggle={(v) => toggleFilter('priority', v)}
        onClear={() => clearFilter('priority')}
      />

      <FilterDropdown
        label="Status"
        selected={filters.column}
        options={[...columns]
          .sort((a, b) => a.position - b.position)
          .map((col) => ({
            value: col.id,
            label: col.name,
            leading: col.color ? (
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: col.color }}
              />
            ) : undefined,
          }))}
        onToggle={(v) => toggleFilter('column', v)}
        onClear={() => clearFilter('column')}
      />

      {assignees.length > 0 && (
        <FilterDropdown
          label="Assignee"
          selected={filters.assignee}
          options={assignees.map((a) => ({
            value: a,
            label: a,
            leading: (
              <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[0.5rem] font-semibold uppercase text-muted-foreground">
                {a.slice(0, 2).toUpperCase()}
              </span>
            ),
          }))}
          onToggle={(v) => toggleFilter('assignee', v)}
          onClear={() => clearFilter('assignee')}
        />
      )}

      {isActive && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="gap-1 text-[0.6rem]">
              {activeFilterCount} active
              <button
                type="button"
                onClick={clearAll}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          </div>
        </>
      )}
    </div>
  )
}

// --- FilterDropdown sub-component (moved from FilterBar) ---

interface FilterOption {
  value: string
  label: string
  leading?: React.ReactNode
}

interface FilterDropdownProps {
  label: string
  selected: string[]
  options: FilterOption[]
  onToggle: (value: string) => void
  onClear: () => void
}

function FilterDropdown({ label, selected, options, onToggle, onClear }: FilterDropdownProps) {
  const hasSelection = selected.length > 0

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={hasSelection ? 'secondary' : 'ghost'}
            size="xs"
            className={cn(
              'gap-1 text-xs',
              hasSelection && 'bg-secondary',
            )}
          />
        }
      >
        {label}
        {hasSelection && (
          <Badge variant="outline" className="ml-0.5 h-4 px-1 text-[0.55rem]">
            {selected.length}
          </Badge>
        )}
        <ChevronDown className="size-3 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="flex flex-col">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onToggle(opt.value)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border',
                  )}
                >
                  {isSelected && (
                    <svg viewBox="0 0 12 12" className="size-2.5">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>

                {opt.leading}
                <span className="truncate">{opt.label}</span>
              </button>
            )
          })}

          {hasSelection && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={onClear}
                className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
