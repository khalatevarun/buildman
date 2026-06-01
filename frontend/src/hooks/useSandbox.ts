import { useState } from 'react'
import { api, API_URL } from '../utility/api'

export type SandboxStatus = 'idle' | 'creating' | 'ready'

interface SandboxStatusResponse {
  status: string
  preview_url?: string
  project_id?: string
  deployed_hash?: string | null
  deployed_url?: string | null
}

interface SandboxDoneEvent {
  type: 'done'
  preview_url: string
  project_id: string
  deployed_hash?: string | null
  deployed_url?: string | null
}

interface EnsureResult {
  deployedHash: string | null
  deployedUrl: string | null
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<SandboxStatus>('idle')
  const [phase, setPhase] = useState<string | null>(null)

  const createProject = async (name: string): Promise<string> => {
    setStatus('creating')
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
  // Returns deployed state so the caller can sync it to Redux.
  const ensureSandbox = async (projectId: string): Promise<EnsureResult> => {
    try {
      const { data } = await api.get<SandboxStatusResponse>(`/sandbox/status?user_id=${userId}`)
      if (data.status === 'ready' && data.preview_url && data.project_id === projectId) {
        setPreviewUrl(data.preview_url)
        setStatus('ready')
        return { deployedHash: data.deployed_hash ?? null, deployedUrl: data.deployed_url ?? null }
      }
    } catch { /* network error — fall through to open */ }

    setStatus('creating')
    const response = await fetch(`${API_URL}/projects/${projectId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    for await (const event of readSSE(response) as AsyncGenerator<SandboxDoneEvent | { type: string; text?: string }>) {
      if (event.type === 'phase') setPhase((event as { type: string; text: string }).text)
      if (event.type === 'done') {
        const done = event as SandboxDoneEvent
        setPreviewUrl(done.preview_url)
        setPhase(null)
        setStatus('ready')
        return { deployedHash: done.deployed_hash ?? null, deployedUrl: done.deployed_url ?? null }
      }
      if (event.type === 'error') {
        setPhase(null)
        setStatus('idle')
        throw new Error((event as { type: string; text: string }).text)
      }
    }
    return { deployedHash: null, deployedUrl: null }
  }

  const destroySandbox = () => {
    if (userId) api.delete(`/sandbox?user_id=${userId}`).catch(() => {})
  }

  return { previewUrl, status, phase, createProject, ensureSandbox, destroySandbox }
}
