import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth'
import { Kanban, Loader2 } from 'lucide-react'

export function LoginPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const { t } = useTranslation()
  const { login, register, loading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (isRegister) {
        await register(name, email, password)
      } else {
        await login(email, password)
      }
    } catch {
      // error is handled in the store
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Kanban className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">
              {t('auth.appName')}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('auth.tagline')}
            </p>
          </div>
        </div>

        <Card className="glass glass-border">
          <CardHeader>
            <CardTitle>
              {isRegister ? t('auth.createAccount') : t('auth.welcomeBack')}
            </CardTitle>
            <CardDescription>
              {isRegister
                ? t('auth.enterDetails')
                : t('auth.signInPrompt')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {isRegister && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="name"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('auth.name')}
                  </label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t('auth.namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t('auth.email')}
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t('auth.password')}
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t('auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                className="mt-1 w-full"
                disabled={loading || !email || !password || (isRegister && !name)}
              >
                {loading && <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />}
                {loading
                  ? (isRegister ? t('auth.creatingAccount') : t('auth.signingIn'))
                  : isRegister
                    ? t('auth.createAccount')
                    : t('auth.signIn')}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                {isRegister ? t('auth.alreadyHaveAccount') : t('auth.dontHaveAccount')}{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => {
                    setIsRegister(!isRegister)
                    clearError()
                  }}
                >
                  {isRegister ? t('auth.signIn') : t('auth.createOne')}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
