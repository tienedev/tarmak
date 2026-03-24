import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import { Search, X, FileText, MessageSquare, ListChecks, Archive } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, type SearchResult } from '@/lib/api'

const typeIcons: Record<string, React.ReactNode> = {
  task: <FileText className="size-3.5 shrink-0 text-blue-500" />,
  comment: <MessageSquare className="size-3.5 shrink-0 text-green-500" />,
  subtask: <ListChecks className="size-3.5 shrink-0 text-amber-500" />,
}

const typeLabelKeys: Record<string, string> = {
  task: 'search.tasks',
  comment: 'search.comments',
  subtask: 'search.subtasks',
}

interface SearchBarProps {
  boardId: string
  onSelectResult: (taskId: string) => void
}

export function SearchBar({ boardId, onSelectResult }: SearchBarProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const doSearch = useCallback(
    async (q: string) => {
      if (q.trim().length === 0) {
        setResults([])
        setShowDropdown(false)
        return
      }
      setLoading(true)
      try {
        const data = await api.searchBoard(boardId, q.trim(), 20, includeArchived)
        setResults(data)
        setShowDropdown(data.length > 0)
      } catch {
        setResults([])
        setShowDropdown(false)
      } finally {
        setLoading(false)
      }
    },
    [boardId, includeArchived],
  )

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), 300)
  }

  const handleSelect = (result: SearchResult) => {
    onSelectResult(result.task_id)
    setExpanded(false)
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  const handleClose = () => {
    setExpanded(false)
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  // Re-search when includeArchived changes (doSearch dep captures includeArchived)
  useEffect(() => {
    if (query.trim()) doSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-trigger on toggle, not on query change (debounced separately)
  }, [includeArchived])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (expanded) {
      document.addEventListener('keydown', handleKey)
      return () => document.removeEventListener('keydown', handleKey)
    }
  }, [expanded])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    if (expanded) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [expanded])

  // Focus input when expanded
  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  // Group results by entity_type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.entity_type] ??= []).push(r)
    return acc
  }, {})

  if (!expanded) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setExpanded(true)}
        className="text-muted-foreground"
        aria-label={t('common.search')}
      >
        <Search className="size-3.5" />
      </Button>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={t('search.placeholder')}
            className="h-7 w-52 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setIncludeArchived((prev) => !prev)}
          className={cn('text-muted-foreground', includeArchived && 'text-foreground bg-muted')}
          title={t('search.includeArchives')}
        >
          <Archive className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={handleClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover shadow-lg">
          <div className="max-h-72 overflow-y-auto p-1">
            {(['task', 'comment', 'subtask'] as const).map((type) => {
              const items = grouped[type]
              if (!items?.length) return null
              return (
                <div key={type}>
                  <p className="px-2 py-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    {t(typeLabelKeys[type] ?? type)}
                  </p>
                  {items.map((r) => (
                    <button
                      key={`${r.entity_type}-${r.entity_id}`}
                      onClick={() => handleSelect(r)}
                      className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                    >
                      {typeIcons[r.entity_type]}
                      <span
                        className="min-w-0 flex-1 text-xs leading-snug"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(r.snippet) }}
                      />
                      {r.archived && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
                          {t('search.archived')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
          {loading && (
            <p className="px-3 py-2 text-center text-xs text-muted-foreground">{t('search.searching')}</p>
          )}
        </div>
      )}
    </div>
  )
}
