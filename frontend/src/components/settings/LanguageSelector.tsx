import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { setLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

const languages = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
]

export function LanguageSelector() {
  const { i18n } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Change language" />
        }
      >
        <Globe className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="end" side="top">
        {languages.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => setLanguage(lang.code)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              i18n.language === lang.code
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-muted',
            )}
          >
            <span>{lang.flag}</span>
            <span>{lang.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
