import { Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Projects } from './pages/Projects'
import { Workspace } from './pages/Workspace'
import { Toaster } from './components/ui/sonner'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/workspace/:projectId" element={<Workspace />} />
      </Routes>
      <Toaster position="bottom-right" />
    </>
  )
}
