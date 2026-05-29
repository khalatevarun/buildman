import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useSelector, useDispatch } from 'react-redux'
import { toast } from 'sonner'
import { useSandbox } from '../hooks/useSandbox'
import { usePrompt } from '../hooks/usePrompt'
import { setPreviewingHash, resetWorkspace, restoreHistory, setDeployedHash, setDeployedUrl, setProjectName, dequeuePrompt, store } from '../store'
import type { RootState } from '../store'
import { ChatPanel } from '../components/ChatPanel'
import { PreviewPane } from '../components/PreviewPane'
import { RestoreConfirmDialog } from '../components/RestoreConfirmDialog'
import { api } from '../utility/api'

interface DeployedUrlBarProps {
  deployedUrl: string | null
  publishingLabel: string | null
}

function DeployedUrlBar({ deployedUrl, publishingLabel }: DeployedUrlBarProps) {
  const [copied, setCopied] = useState(false)

  if (!deployedUrl && !publishingLabel) return null

  const handleCopy = () => {
    if (!deployedUrl) return
    navigator.clipboard.writeText(deployedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (publishingLabel) {
    return (
      <div className="flex items-center justify-center gap-2.5 px-4 py-2 shrink-0 bg-primary">
        <span className="w-3 h-3 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin shrink-0" />
        <span className="text-[11px] font-medium text-primary-foreground">{publishingLabel}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 shrink-0 bg-primary">
      <span className="text-[11px] font-medium text-primary-foreground/80">Published</span>
      <a
        href={deployedUrl!}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-medium text-primary-foreground hover:text-primary-foreground/80 transition-colors duration-100 truncate max-w-xs"
      >
        {deployedUrl!.replace('https://', '')}
      </a>
      <button
        onClick={handleCopy}
        title="Copy link"
        className="text-[11px] px-2 py-0.5 rounded transition-colors duration-100 shrink-0 bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const { user } = useUser()
  const userId = user?.id ?? null
  const dispatch = useDispatch()
  const previewingHash = useSelector((s: RootState) => s.app.previewingHash)
  const streaming = useSelector((s: RootState) => s.app.streaming)
  const deployedUrl = useSelector((s: RootState) => s.app.deployedUrl)
  const checkpoints = useSelector((s: RootState) => s.app.checkpoints)
  const projectName = useSelector((s: RootState) => s.app.projectName)

  const { previewUrl, ensureSandbox } = useSandbox(userId)
  const { sendPrompt, stopPrompt } = usePrompt(userId, projectId ?? null)
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
      try {
        await ensureSandbox(projectId)
      } catch (err: any) {
        const msg = err?.message || 'Sandbox failed to start'
        toast.error(msg, {
          action: { label: 'Refresh', onClick: () => window.location.reload() },
          duration: Infinity,
        })
        return
      }
      if (!active) return
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
        try {
          await sendPrompt(initialPrompt)
        } catch {
          toast.error('Connection error — please try again')
        }
      }
    }
    init()
    return () => { active = false }
  }, [projectId, userId])

  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      const queue = store.getState().app.promptQueue
      if (queue.length > 0) {
        const next = queue[0]
        dispatch(dequeuePrompt())
        sendPrompt(next)
      }
    }
    prevStreamingRef.current = streaming
  }, [streaming])

  const handleDeploy = async (hash: string): Promise<string> => {
    if (!userId) throw new Error('Not authenticated')
    setPublishingHash(hash)
    try {
      const r = await api.post<{ url: string; deployedHash: string }>('/deploy', { user_id: userId, hash })
      dispatch(setDeployedHash(r.data.deployedHash))
      dispatch(setDeployedUrl(r.data.url))
      return r.data.url
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || null
      toast.error(msg || 'Publish failed — try again')
      throw err
    } finally {
      setPublishingHash(null)
    }
  }

  const handleExitPreview = async () => {
    if (!userId) return
    try {
      await api.post('/preview-exit', null, { params: { user_id: userId } })
      dispatch(setPreviewingHash(null))
    } catch {
      toast.error("Couldn't exit preview mode")
    }
  }

  const handleVersionChange = async (hash: string | null) => {
    if (!userId) return
    if (hash === null) {
      await handleExitPreview()
    } else {
      try {
        await api.post('/preview', { user_id: userId, hash })
        dispatch(setPreviewingHash(hash))
      } catch {
        toast.error("Couldn't switch version")
      }
    }
  }

  const handleRestoreFromBanner = async () => {
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
      toast.error('Restore failed — try again')
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {(() => {
        const previewIdx = previewingHash ? checkpoints.findIndex(cp => cp.hash === previewingHash) : -1
        const previewVersion = previewIdx + 1
        const previewTimestamp = previewIdx >= 0 ? checkpoints[previewIdx].timestamp : 0
        const timeAgoStr = previewTimestamp ? timeAgo(previewTimestamp) : ''
        return (
          <>
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
            <DeployedUrlBar
              deployedUrl={publishingHash ? null : deployedUrl}
              publishingLabel={(() => {
                if (!publishingHash) return null
                const vIdx = checkpoints.findIndex(cp => cp.hash === publishingHash)
                const vNum = vIdx >= 0 ? vIdx + 1 : checkpoints.length
                const name = projectName ? ` of ${projectName}` : ''
                return `Publishing v${vNum}${name}…`
              })()}
            />
          </>
        )
      })()}

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
            {/* Center grip dots */}
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
