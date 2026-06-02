import { Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Home } from './pages/Home'
import { Apps } from './pages/Apps'
import { Workspace } from './pages/Workspace'
import { Toaster } from './components/ui/sonner'

export default function App() {
  return (
    <>
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
