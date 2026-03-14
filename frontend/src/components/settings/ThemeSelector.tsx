import { useState, useEffect } from 'react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  type ThemeMode,
  type AccentTheme,
  accentThemes,
  getStoredMode,
  getStoredAccent,
  storeMode,
  storeAccent,
  applyThemeMode,
  applyAccentTheme,
} from '@/lib/themes'
import { Sun, Moon, Monitor } from 'lucide-react'

const modeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeSelector() {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [accent, setAccent] = useState<string>(getStoredAccent)

  useEffect(() => {
    storeMode(mode)
    applyThemeMode(mode)
  }, [mode])

  useEffect(() => {
    storeAccent(accent)
    applyAccentTheme(accent)
  }, [accent])

  const ModeIcon = modeOptions.find((m) => m.value === mode)?.icon ?? Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-xs" />
        }
      >
        <ModeIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Theme Mode</DropdownMenuLabel>
        {modeOptions.map((opt) => {
          const Icon = opt.icon
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className={cn(mode === opt.value && 'bg-accent')}
            >
              <Icon className="size-3.5" />
              {opt.label}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Accent Color</DropdownMenuLabel>
        <div className="flex gap-1.5 px-1.5 py-1">
          {accentThemes.map((theme: AccentTheme) => (
            <button
              key={theme.name}
              type="button"
              onClick={() => setAccent(theme.name)}
              className={cn(
                'flex size-6 items-center justify-center rounded-full transition-all',
                accent === theme.name && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
              )}
              title={theme.label}
            >
              <span
                className="size-4 rounded-full"
                style={{ backgroundColor: theme.preview }}
              />
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
