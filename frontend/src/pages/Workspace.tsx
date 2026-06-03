import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import { toast } from 'sonner'
import { useSandbox } from '../hooks/useSandbox'
import { usePrompt } from '../hooks/usePrompt'
import {
  setPreviewingHash,
  resetWorkspace,
  restoreHistory,
  setDeployedHash,
  setDeployedUrl,
  setEnvNeeded,
  setProjectName,
  dequeuePrompt,
  useAppDispatch,
  useAppSelector,
} from '../store'
import { ChatPanel } from '../components/ChatPanel'
import { PreviewPane } from '../components/PreviewPane'
import { playCompletionSound } from '../utility/sounds'
import { RestoreConfirmDialog } from '../components/RestoreConfirmDialog'
import { api } from '../utility/api'
import { timeAgo } from '../utility/time'

export function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const { user } = useUser()
  const { getToken } = useAuth()
  const userId = user?.id ?? null
  const dispatch = useAppDispatch()
  const previewingHash = useAppSelector(s => s.app.previewingHash)
  const streaming = useAppSelector(s => s.app.streaming)
  const deployedUrl = useAppSelector(s => s.app.deployedUrl)
  const checkpoints = useAppSelector(s => s.app.checkpoints)
  const projectName = useAppSelector(s => s.app.projectName)
  const promptQueue = useAppSelector(s => s.app.promptQueue)
  const messages = useAppSelector(s => s.app.messages)

  const { previewUrl, ensureSandbox } = useSandbox(userId, getToken)
  const { sendPrompt, stopPrompt } = usePrompt(userId, projectId ?? null, getToken)

  // sendPrompt is not memoized — it must close over fresh state on each call.
  // Store it in a ref so the streaming effect always calls the latest version.
  const sendPromptRef = useRef(sendPrompt)
  useEffect(() => { sendPromptRef.current = sendPrompt }, [sendPrompt])

  useEffect(() => {
    document.title = projectName ? `${projectName} | Buildman` : 'Buildman — Build apps with AI'
    return () => { document.title = 'Buildman — Build apps with AI' }
  }, [projectName])

  const prevStreamingRef = useRef(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [panelWidth, setPanelWidth] = useState(320)
  const [bannerRestoreOpen, setBannerRestoreOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [publishingHash, setPublishingHash] = useState<string | null>(null)
  const chatPanelRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = panelWidth
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  useEffect(() => {
    const clamp = (v: number) => Math.min(Math.max(v, 240), 600)

    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !chatPanelRef.current) return
      const next = clamp(startWidth.current + (e.clientX - startX.current))
      // Mutate DOM directly — no React re-render per pixel
      chatPanelRef.current.style.width = `${next}px`
    }

    const onUp = (e: MouseEvent) => {
      if (!dragging.current) return
      const next = clamp(startWidth.current + (e.clientX - startX.current))
      dragging.current = false
      setIsDragging(false)
      // Commit final value to React state and clear inline style
      if (chatPanelRef.current) chatPanelRef.current.style.width = ''
      setPanelWidth(next)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    if (!projectId || !userId) return
    dispatch(resetWorkspace())
    let active = true
    const init = async () => {
      let deployed: { deployedHash: string | null; deployedUrl: string | null; envNeeded: import('../store').EnvVarGroup[] }
      try {
        deployed = await ensureSandbox(projectId)
      } catch (err: any) {
        const msg = err?.message || 'Sandbox failed to start'
        toast.error(msg, {
          action: { label: 'Refresh', onClick: () => window.location.reload() },
          duration: Infinity,
        })
        return
      }
      if (!active) return
      dispatch(setDeployedHash(deployed.deployedHash))
      dispatch(setDeployedUrl(deployed.deployedUrl))
      if (deployed.envNeeded.length > 0) dispatch(setEnvNeeded(deployed.envNeeded))
      // Fetch project name for existing projects (new projects get name from Claude's <name> tag)
      try {
        const { data } = await api.get<{ projects: { project_id: string; name: string }[] }>(`/projects?user_id=${userId}`)
        const match = data.projects.find(p => p.project_id === projectId)
        if (active && match?.name && match.name !== '__prewarm__') dispatch(setProjectName(match.name))
      } catch { /* non-critical */ }
      if (!active) return
      try {
        const { data } = await api.get(`/projects/${projectId}/chat?user_id=${userId}`)
        if (active && data?.messages?.length) dispatch(restoreHistory(data))
      } catch { /* no history yet */ }
      if (!active) return
      const initialPrompt = location.state?.initialPrompt
      if (initialPrompt) {
        // Clear from history state immediately so reload doesn't re-fire the prompt
        window.history.replaceState({ ...window.history.state, usr: { ...location.state, initialPrompt: undefined } }, '')
        try {
          await sendPromptRef.current(initialPrompt)
        } catch {
          toast.error('Connection error — please try again')
        }
      }
    }
    init()
    return () => { active = false }
  }, [projectId, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When streaming finishes: process next queued prompt, then persist chat to server.
  // Running after the streaming→false render means messages/checkpoints are fully up to date.
  useEffect(() => {
    if (!prevStreamingRef.current || streaming) {
      prevStreamingRef.current = streaming
      return
    }
    prevStreamingRef.current = streaming

    playCompletionSound()

    const queue = promptQueue
    if (queue.length > 0) {
      dispatch(dequeuePrompt())
      sendPromptRef.current(queue[0])
    }

    if (projectId && userId && messages.length > 0) {
      api.post(`/projects/${projectId}/chat`, { user_id: userId, messages, checkpoints }).catch(() => {})
    }
  }, [streaming, dispatch, projectId, userId, messages, checkpoints, promptQueue])

  const handleDeploy = useCallback(async (hash: string): Promise<string> => {
    if (!userId) throw new Error('Not authenticated')
    setPublishingHash(hash)
    try {
      const r = await api.post<{ url: string; deployedHash: string }>('/deploy', { user_id: userId, hash })
      dispatch(setDeployedHash(r.data.deployedHash))
      dispatch(setDeployedUrl(r.data.url))
      const publishedUrl = r.data.url
      toast.success(
        projectName ? `"${projectName}" is live on the internet` : 'App is live on the internet',
        { action: { label: 'Open', onClick: () => window.open(publishedUrl, '_blank') } }
      )
      return publishedUrl
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || null
      toast.error(msg || (projectName ? `Couldn't publish "${projectName}" — try again` : 'Publish failed — try again'))
      throw err
    } finally {
      setPublishingHash(null)
    }
  }, [userId, projectName, dispatch])

  const handleExitPreview = useCallback(async () => {
    if (!userId) return
    try {
      await api.post('/preview-exit', null, { params: { user_id: userId } })
      dispatch(setPreviewingHash(null))
    } catch {
      toast.error("Couldn't exit preview mode — try refreshing")
    }
  }, [userId, dispatch])

  const handleVersionChange = useCallback(async (hash: string | null) => {
    if (!userId) return
    if (hash === null) {
      await handleExitPreview()
    } else {
      try {
        await api.post('/preview', { user_id: userId, hash })
        dispatch(setPreviewingHash(hash))
      } catch {
        toast.error("Couldn't switch to that version — try again")
      }
    }
  }, [userId, dispatch, handleExitPreview])

  const handleRestoreFromBanner = useCallback(async () => {
    if (!userId || !previewingHash) return
    try {
      const { data } = await api.post<{ ok: boolean; messages: { role: 'user' | 'assistant'; text: string; activities: string[] }[]; checkpoints: { hash: string; timestamp: number }[] }>(
        '/restore', { user_id: userId, hash: previewingHash }
      )
      if (data?.messages && data?.checkpoints) {
        dispatch(restoreHistory({ messages: data.messages, checkpoints: data.checkpoints }))
      }
      dispatch(setPreviewingHash(null))
    } catch {
      toast.error('Restore failed — try refreshing the page')
    }
  }, [userId, previewingHash, dispatch])

  // Derive preview banner values above JSX — no IIFE in render
  const previewIdx = previewingHash ? checkpoints.findIndex(cp => cp.hash === previewingHash) : -1
  const previewVersion = previewIdx + 1
  const previewTimestamp = previewIdx >= 0 ? checkpoints[previewIdx].timestamp : 0
  const timeAgoStr = previewTimestamp ? timeAgo(previewTimestamp) : ''

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      <RestoreConfirmDialog
        open={bannerRestoreOpen}
        versionNumber={previewVersion}
        timeAgo={timeAgoStr}
        showPreviewHint={false}
        onConfirm={async () => { setBannerRestoreOpen(false); await handleRestoreFromBanner() }}
        onCancel={() => setBannerRestoreOpen(false)}
      />

      {previewingHash && (
        <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border text-xs">
          <span className="text-muted-foreground">Viewing an earlier version</span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setBannerRestoreOpen(true)}
              className="text-foreground hover:text-muted-foreground transition-colors"
            >
              Restore this version
            </button>
            <button
              onClick={handleExitPreview}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to latest
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Chat */}
        {!isExpanded && (
          <div
            ref={chatPanelRef}
            className="flex flex-col shrink-0"
            style={{ width: panelWidth }}
          >
            <ChatPanel onSend={sendPrompt} onStop={stopPrompt} userId={userId} publishingHash={publishingHash} onDeploy={handleDeploy} projectName={projectName} />
          </div>
        )}

        {/* Drag handle */}
        {!isExpanded && (
          <div
            onMouseDown={onDividerMouseDown}
            className="w-px shrink-0 cursor-col-resize group relative z-10 hover:bg-primary/30 transition-colors duration-150"
            style={{ background: 'var(--border)' }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <span className="w-0.5 h-3 rounded-full bg-primary/50" />
              <span className="w-0.5 h-3 rounded-full bg-primary/50" />
              <span className="w-0.5 h-3 rounded-full bg-primary/50" />
            </div>
          </div>
        )}

        {/* Right panel — Preview */}
        <div className="flex-1 bg-background min-w-0 relative">
          <PreviewPane
            previewUrl={previewUrl}
            streaming={streaming}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded(e => !e)}
            checkpoints={checkpoints}
            previewingHash={previewingHash}
            onVersionChange={handleVersionChange}
            deployedUrl={deployedUrl}
            publishing={!!publishingHash}
          />
          {/* Blocks iframe from stealing mouse events while the divider is being dragged */}
          {isDragging && (
            <div className="absolute inset-0 z-50" style={{ cursor: 'col-resize' }} />
          )}
        </div>
      </div>
    </div>
  )
}
