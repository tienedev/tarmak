import { useState } from 'react'
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
              Kanwise
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage your projects with clarity
            </p>
          </div>
        </div>

        <Card className="glass glass-border">
          <CardHeader>
            <CardTitle>
              {isRegister ? 'Create an account' : 'Welcome back'}
            </CardTitle>
            <CardDescription>
              {isRegister
                ? 'Enter your details to get started'
                : 'Sign in to your account'}
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
                    Name
                  </label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
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
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
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
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
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
                  ? 'Signing in…'
                  : isRegister
                    ? 'Create account'
                    : 'Sign in'}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => {
                    setIsRegister(!isRegister)
                    clearError()
                  }}
                >
                  {isRegister ? 'Sign in' : 'Create one'}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
