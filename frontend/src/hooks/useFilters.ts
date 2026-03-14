import { create } from 'zustand'
import { useMemo } from 'react'
import type { Task } from '@/lib/api'

export interface FilterState {
  priority: string[]
  assignee: string[]
  column: string[]
}

interface FilterStore {
  filters: FilterState
  setFilter: (key: keyof FilterState, values: string[]) => void
  toggleFilter: (key: keyof FilterState, value: string) => void
  clearFilter: (key: keyof FilterState) => void
  clearAll: () => void
  hasActiveFilters: () => boolean
}

const emptyFilters: FilterState = {
  priority: [],
  assignee: [],
  column: [],
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filters: { ...emptyFilters },

  setFilter: (key, values) => {
    set({ filters: { ...get().filters, [key]: values } })
  },

  toggleFilter: (key, value) => {
    const current = get().filters[key]
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    set({ filters: { ...get().filters, [key]: next } })
  },

  clearFilter: (key) => {
    set({ filters: { ...get().filters, [key]: [] } })
  },

  clearAll: () => {
    set({ filters: { ...emptyFilters } })
  },

  hasActiveFilters: () => {
    const { filters } = get()
    return filters.priority.length > 0 || filters.assignee.length > 0 || filters.column.length > 0
  },
}))

export function useFilteredTasks(tasks: Task[]): Task[] {
  const filters = useFilterStore((s) => s.filters)

  return useMemo(() => {
    let result = tasks

    if (filters.priority.length > 0) {
      result = result.filter((t) => filters.priority.includes(t.priority))
    }

    if (filters.assignee.length > 0) {
      result = result.filter(
        (t) => t.assignee != null && filters.assignee.includes(t.assignee),
      )
    }

    if (filters.column.length > 0) {
      result = result.filter((t) => filters.column.includes(t.column_id))
    }

    return result
  }, [tasks, filters])
}
