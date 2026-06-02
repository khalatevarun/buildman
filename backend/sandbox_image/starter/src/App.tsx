import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 1000 * 60 * 5 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-dvh bg-background text-foreground antialiased">
          <Routes>
            {/* Add routes here */}
          </Routes>
          <Toaster richColors position="top-right" />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
