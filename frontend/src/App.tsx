import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Analytics } from '@vercel/analytics/react'
import { Home } from './pages/Home'
import { Apps } from './pages/Apps'
import { Workspace } from './pages/Workspace'
import { Toaster } from './components/ui/sonner'
import { api } from './utility/api'

function ClerkAxiosSync() {
  const { getToken } = useAuth()
  useEffect(() => {
    const id = api.interceptors.request.use(async (config) => {
      const token = await getToken()
      if (token) config.headers.Authorization = `Bearer ${token}`
      return config
    })
    return () => api.interceptors.request.eject(id)
  }, [getToken])
  return null
}

export default function App() {
  return (
    <>
      <ClerkAxiosSync />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/apps" element={<Apps />} />
        <Route path="/workspace/:projectId" element={<Workspace />} />
      </Routes>
      <Toaster position="bottom-right" />
      <Analytics />
    </>
  )
}
