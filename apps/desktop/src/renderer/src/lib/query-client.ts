import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      networkMode: 'always',
      staleTime: 60_000,
    },
    mutations: {
      retry: 0,
      networkMode: 'always',
    },
  },
})
