import { createTRPCReact } from '@trpc/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@tarmak/api/trpc'

// React hooks (for components)
export const trpc = createTRPCReact<AppRouter>()

const trpcUrl = `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}/trpc`

function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: trpcUrl,
        headers: authHeaders,
      }),
    ],
  })
}

// Vanilla client (for Zustand stores and non-React code)
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: trpcUrl,
      headers: authHeaders,
    }),
  ],
})
