import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    login: vi.fn(),
    register: vi.fn(),
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the login form by default', () => {
    render(<LoginPage />)
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('toggles to register form', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByText('Create one'))
    expect(screen.getByText('Create an account')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('toggles back to login form', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByText('Create one'))
    await user.click(screen.getByText('Sign in'))
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })
})
