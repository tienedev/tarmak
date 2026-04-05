import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, createTrpcClient } from './lib/trpc'
import App from './App.tsx'

export function Root() {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(createTrpcClient)

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  )
}
