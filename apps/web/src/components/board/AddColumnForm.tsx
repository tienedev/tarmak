import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'

interface AddColumnFormProps {
  boardId: string
}

export function AddColumnForm({ boardId }: AddColumnFormProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const createColumn = useBoardStore((s) => s.createColumn)

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      await createColumn(boardId, trimmed)
      setName('')
      setExpanded(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setName('')
      setExpanded(false)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex h-10 w-72 shrink-0 items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-foreground/10 text-xs font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:bg-foreground/[3%] hover:text-foreground"
      >
        <Plus className="size-3.5" />
        {t('board.addColumn')}
      </button>
    )
  }

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl glass-subtle glass-border p-3">
      <Input
        ref={inputRef}
        placeholder="Column name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 text-sm"
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setName('')
            setExpanded(false)
          }}
          className="h-6 text-xs text-muted-foreground"
        >
          {t('common.cancel')}
        </Button>
        <Button
          size="xs"
          onClick={handleSubmit}
          disabled={!name.trim() || submitting}
          className="h-6 text-xs"
        >
          {submitting && <Loader2 className="size-3 animate-spin" />}
          {submitting ? t('common.adding') : t('common.add')}
        </Button>
      </div>
    </div>
  )
}
