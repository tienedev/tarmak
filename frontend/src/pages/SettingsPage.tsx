import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { api, type ApiKey } from '@/lib/api'
import { setLanguage } from '@/i18n'
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
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Key,
  Loader2,
  Moon,
  Monitor,
  Palette,
  Plus,
  Sun,
  Trash2,
  User,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const languages = [
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'fr', label: 'Fran\u00E7ais', flag: '\u{1F1EB}\u{1F1F7}' },
]

const modeOptions: { value: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
]

type SettingsTab = 'profile' | 'appearance' | 'apikeys'

const tabs: { id: SettingsTab; labelKey: string; icon: typeof User }[] = [
  { id: 'profile', labelKey: 'userSettings.profile', icon: User },
  { id: 'appearance', labelKey: 'userSettings.appearance', icon: Palette },
  { id: 'apikeys', labelKey: 'userSettings.apiKeys', icon: Key },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 glass-heavy glass-border px-6">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('common.back')}
          onClick={() => (window.location.hash = '#/')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <h1 className="text-sm font-bold">{t('userSettings.title')}</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="hidden sm:flex w-56 shrink-0 flex-col gap-1 border-r border-border/40 p-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
                {t(tab.labelKey)}
              </button>
            )
          })}
        </nav>

        {/* Mobile tab bar */}
        <div className="flex sm:hidden shrink-0 gap-1 border-b border-border/40 px-4 py-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon className="size-3.5" />
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            {activeTab === 'profile' && <ProfileSection />}
            {activeTab === 'appearance' && <AppearanceSection />}
            {activeTab === 'apikeys' && <ApiKeysSection />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Profile Section                                                    */
/* ------------------------------------------------------------------ */

function ProfileSection() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">{t('userSettings.profile')}</h2>
        <p className="text-sm text-muted-foreground">{t('userSettings.profileDesc')}</p>
      </div>

      {/* Avatar + info */}
      <div className="flex items-center gap-5">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary uppercase">
          {user?.name?.charAt(0) ?? '?'}
        </div>
        <div>
          <p className="text-base font-semibold">{user?.name}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Read-only fields */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('auth.name')}</label>
          <Input value={user?.name ?? ''} readOnly className="bg-muted/50" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('auth.email')}</label>
          <Input value={user?.email ?? ''} readOnly className="bg-muted/50" />
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Sign out */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t('auth.signOut')}</p>
          <p className="text-xs text-muted-foreground">{t('userSettings.signOutDesc')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          {t('auth.signOut')}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Appearance Section                                                 */
/* ------------------------------------------------------------------ */

function AppearanceSection() {
  const { t, i18n } = useTranslation()
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">{t('userSettings.appearance')}</h2>
        <p className="text-sm text-muted-foreground">{t('userSettings.appearanceDesc')}</p>
      </div>

      {/* Theme mode */}
      <div>
        <h3 className="mb-3 text-sm font-medium">{t('theme.mode')}</h3>
        <div className="grid grid-cols-3 gap-4">
          {modeOptions.map((opt) => {
            const Icon = opt.icon
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`flex flex-col items-center gap-2.5 rounded-xl border-2 px-4 py-5 transition-all ${
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border/60 hover:border-border hover:bg-muted/50 hover:-translate-y-0.5 hover:shadow-sm'
                }`}
              >
                <Icon className={`size-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-xs font-medium ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                  {t(opt.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Accent color */}
      <div>
        <h3 className="mb-3 text-sm font-medium">{t('theme.accent')}</h3>
        <div className="flex flex-wrap gap-4">
          {accentThemes.map((theme: AccentTheme) => {
            const active = accent === theme.name
            return (
              <button
                key={theme.name}
                type="button"
                onClick={() => setAccent(theme.name)}
                className={`flex flex-col items-center gap-2.5 rounded-xl border-2 px-6 py-4 transition-all ${
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border/60 hover:border-border hover:bg-muted/50 hover:-translate-y-0.5 hover:shadow-sm'
                }`}
              >
                <span
                  className={`size-7 rounded-full shadow-sm transition-transform ${active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: theme.preview }}
                />
                <span className={`text-xs font-medium ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                  {theme.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Language */}
      <div>
        <h3 className="mb-1 text-sm font-medium flex items-center gap-2">
          <Globe className="size-4" />
          {t('settings.language')}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">{t('settings.languageDesc')}</p>
        <div className="flex flex-wrap gap-4">
          {languages.map((lang) => {
            const active = i18n.language === lang.code
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => setLanguage(lang.code)}
                className={`flex items-center gap-3 rounded-xl border-2 px-5 py-3.5 transition-all ${
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border/60 hover:border-border hover:bg-muted/50 hover:-translate-y-0.5 hover:shadow-sm'
                }`}
              >
                <span className="text-lg">{lang.flag}</span>
                <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                  {lang.label}
                </span>
                {active && <Check className="size-4 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  API Keys Section                                                   */
/* ------------------------------------------------------------------ */

function ApiKeysSection() {
  const { t } = useTranslation()
  const notify = useNotificationStore((s) => s.add)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const fetchKeys = async () => {
    try {
      const res = await api.listApiKeys()
      setKeys(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKeys()
  }, [])

  const handleCreate = async () => {
    if (!newKeyName.trim() || creating) return
    setCreating(true)
    try {
      const res = await api.createApiKey({ name: newKeyName.trim() })
      setRevealedKey(res.key)
      setKeys((prev) => [...prev, res.api_key])
      setCreateOpen(false)
      setNewKeyName('')
    } catch {
      notify(t('userSettings.apiKeyCreateFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteApiKey(id)
      setKeys((prev) => prev.filter((k) => k.id !== id))
      setDeleteId(null)
    } catch {
      notify(t('userSettings.apiKeyDeleteFailed'))
    }
  }

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text)
    notify(t('common.copiedToClipboard'))
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('userSettings.apiKeys')}</h2>
          <p className="text-sm text-muted-foreground">{t('userSettings.apiKeysDesc')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" />
          {t('userSettings.createKey')}
        </Button>
      </div>

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="mb-2 text-sm font-medium">{t('userSettings.keyCreated')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono break-all">
              {revealedKey}
            </code>
            <Button variant="outline" size="icon-xs" onClick={() => copyKey(revealedKey)}>
              <Copy className="size-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('userSettings.keyOnceWarning')}</p>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
          <Loader2 className="size-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center">
          <Key className="mx-auto mb-2 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('userSettings.noApiKeys')}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border/60">
          {keys.map((key) => (
            <div key={key.id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30">
              <Key className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{key.name}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <code className="font-mono">{key.key_prefix}...</code>
                  {key.last_used_at && (
                    <>
                      <span>&middot;</span>
                      <span>{t('userSettings.lastUsed', { date: new Date(key.last_used_at).toLocaleDateString() })}</span>
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-red-500"
                onClick={() => setDeleteId(key.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('userSettings.createKey')}</DialogTitle>
          </DialogHeader>
          <Input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder={t('userSettings.keyNamePlaceholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!newKeyName.trim() || creating}>
              {creating ? t('common.creating') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('userSettings.deleteKeyConfirm')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('userSettings.deleteKeyWarning')}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => deleteId && handleDelete(deleteId)}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
