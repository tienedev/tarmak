import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'

interface MentionListProps {
  items: { id: string; name: string }[]
  command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setSelectedIndex(0), [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) command({ id: item.id, label: item.name })
          return true
        }
        return false
      },
    }))

    if (!items.length) return null

    return (
      <div className="z-50 rounded-md border bg-popover p-1 shadow-md">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm ${
              index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
            }`}
            onClick={() => command({ id: item.id, label: item.name })}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold uppercase text-muted-foreground">
              {item.name.slice(0, 2)}
            </span>
            {item.name}
          </button>
        ))}
      </div>
    )
  },
)

MentionList.displayName = 'MentionList'
