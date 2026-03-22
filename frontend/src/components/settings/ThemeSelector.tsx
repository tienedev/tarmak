import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
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

const modeOptions: { value: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
]

export function ThemeSelector() {
  const { t } = useTranslation()
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
          <Button variant="ghost" size="icon-xs" aria-label={t('theme.changeTheme')} />
        }
      >
        <ModeIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('theme.mode')}</DropdownMenuLabel>
          {modeOptions.map((opt) => {
            const Icon = opt.icon
            return (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={cn(mode === opt.value && 'bg-accent')}
              >
                <Icon className="size-3.5" />
                {t(opt.labelKey)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('theme.accent')}</DropdownMenuLabel>
          <div className="flex gap-2 px-1.5 py-1.5">
            {accentThemes.map((theme: AccentTheme) => (
              <button
                key={theme.name}
                type="button"
                onClick={() => setAccent(theme.name)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full transition-all',
                  accent === theme.name && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                )}
                title={theme.label}
              >
                <span
                  className="size-5 rounded-full shadow-sm"
                  style={{ backgroundColor: theme.preview }}
                />
              </button>
            ))}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
