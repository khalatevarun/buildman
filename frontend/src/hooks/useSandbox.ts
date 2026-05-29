import { useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { setDeployedHash, setDeployedUrl } from '../store'
import { api, API_URL } from '../utility/api'

export type SandboxStatus = 'idle' | 'creating' | 'ready'

interface SandboxInfo {
  project_id: string
  preview_url: string
}

async function* readSSE(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try { yield JSON.parse(line.slice(6)) } catch { /* skip malformed */ }
    }
  }
}

export function useSandbox(userId: string | null) {
  const dispatch = useDispatch()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<SandboxStatus>('idle')
  const [phase, setPhase] = useState<string | null>(null)
  const prewarmRef = useRef<Promise<SandboxInfo | null> | null>(null)
  const prewarmUsedRef = useRef(false)

  // Silently starts a sandbox in the background with a placeholder name.
  const prewarm = () => {
    if (!userId || prewarmRef.current) return
    prewarmRef.current = (async () => {
      const response = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, project_name: '__prewarm__' }),
      })
      for await (const event of readSSE(response)) {
        if (event.type === 'done') {
          setPreviewUrl(event.preview_url)
          dispatch(setDeployedHash(null))
          return { project_id: event.project_id, preview_url: event.preview_url } as SandboxInfo
        }
        if (event.type === 'error') return null
      }
      return null
    })().catch(() => {
      prewarmRef.current = null
      return null
    })
  }

  // Called when user clicks Build. If prewarm is done, reuses that sandbox.
  const createProject = async (name: string): Promise<string> => {
    setStatus('creating')

    if (prewarmRef.current) {
      const info = await prewarmRef.current
      if (info) {
        prewarmUsedRef.current = true
        await api.patch(`/projects/${info.project_id}`, { user_id: userId, name }).catch(() => {})
        dispatch(setDeployedHash(null))
        setStatus('ready')
        return info.project_id
      }
    }

    // No prewarm available — stream creation phases
    setPhase('Provisioning sandbox…')
    const response = await fetch(`${API_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, project_name: name }),
    })
    for await (const event of readSSE(response)) {
      if (event.type === 'phase') setPhase(event.text)
      if (event.type === 'done') {
        setPreviewUrl(event.preview_url)
        dispatch(setDeployedHash(null))
        dispatch(setDeployedUrl(null))
        setPhase(null)
        setStatus('ready')
        return event.project_id as string
      }
      if (event.type === 'error') {
        setPhase(null)
        setStatus('idle')
        throw new Error(event.text)
      }
    }
    throw new Error('Project creation stream ended without a done event')
  }

  // Ensures the sandbox is ready for a given project. Used by Workspace on mount.
  // Fast-path: if the sandbox is already running this exact project, returns immediately.
  // Slow-path: spins up a new sandbox and streams phases to the overlay.
  const ensureSandbox = async (projectId: string): Promise<void> => {
    // Quick check — avoids showing the overlay for a page refresh or re-navigation
    try {
      const { data } = await api.get<{
        status: string
        preview_url?: string
        project_id?: string
        deployed_hash?: string | null
      }>(`/sandbox/status?user_id=${userId}`)
      if (data.status === 'ready' && data.preview_url && data.project_id === projectId) {
        setPreviewUrl(data.preview_url)
        dispatch(setDeployedHash(data.deployed_hash ?? null))
        dispatch(setDeployedUrl((data as any).deployed_url ?? null))
        setStatus('ready')
        return
      }
    } catch { /* network error — fall through to open */ }

    // Sandbox dead or running a different project — open with SSE phases
    setStatus('creating')
    const response = await fetch(`${API_URL}/projects/${projectId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    for await (const event of readSSE(response)) {
      if (event.type === 'phase') setPhase(event.text)
      if (event.type === 'done') {
        setPreviewUrl(event.preview_url)
        dispatch(setDeployedHash(event.deployed_hash ?? null))
        dispatch(setDeployedUrl(event.deployed_url ?? null))
        setPhase(null)
        setStatus('ready')
        return
      }
      if (event.type === 'error') {
        setPhase(null)
        setStatus('idle')
        throw new Error(event.text)
      }
    }
  }

  const destroySandbox = () => {
    if (userId) api.delete(`/sandbox?user_id=${userId}`).catch(() => {})
  }

  // Terminates the prewarm sandbox if it was never used as a real project.
  // Call on Home unmount so orphaned sandboxes don't accumulate.
  const cancelPrewarm = async () => {
    if (!userId || prewarmUsedRef.current || !prewarmRef.current) return
    const info = await prewarmRef.current.catch(() => null)
    if (info) api.delete(`/sandbox?user_id=${userId}`).catch(() => {})
  }

  return { previewUrl, status, phase, prewarm, createProject, ensureSandbox, destroySandbox, cancelPrewarm }
}
