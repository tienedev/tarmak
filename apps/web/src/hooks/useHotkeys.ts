import { useEffect } from 'react'

interface HotkeyAction {
  key: string
  ctrl?: boolean
  meta?: boolean
  handler: () => void
  allowInInput?: boolean
}

export function useHotkeys(actions: HotkeyAction[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      for (const action of actions) {
        const metaMatch = action.meta ? (e.metaKey || e.ctrlKey) : true
        const ctrlMatch = action.ctrl ? e.ctrlKey : true
        const noModRequired = !action.meta && !action.ctrl

        if (e.key.toLowerCase() === action.key.toLowerCase() && metaMatch && ctrlMatch) {
          if (noModRequired && (e.metaKey || e.ctrlKey || e.altKey)) continue
          if (isInput && !action.allowInInput) continue
          e.preventDefault()
          action.handler()
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [actions])
}
