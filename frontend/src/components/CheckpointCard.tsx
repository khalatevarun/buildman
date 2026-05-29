import { useState } from 'react'
import { RestoreConfirmDialog } from './RestoreConfirmDialog'

interface Props {
  hash: string
  timestamp: number
  versionNumber: number
  totalVersions: number
  isDeployed: boolean
  deployedUrl: string | null
  publishing: boolean
  onPreview: (hash: string) => void
  onRestore: (hash: string) => void
  onDeploy: (hash: string) => Promise<string>
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.5 7.5H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M4.5 2H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6.5M7 1h3m0 0v3m0-3L5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function CheckpointCard({ hash, timestamp, versionNumber, totalVersions, isDeployed, deployedUrl, publishing, onPreview, onRestore, onDeploy }: Props) {
  const [loading, setLoading] = useState<'preview' | 'restore' | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handlePreview = async () => {
    setLoading('preview')
    onPreview(hash)
    setLoading(null)
  }

  const handleRestoreClick = () => {
    setConfirmOpen(true)
  }

  const handleRestoreConfirm = async () => {
    setConfirmOpen(false)
    setLoading('restore')
    onRestore(hash)
    setLoading(null)
  }

  const handleDeploy = async () => {
    onDeploy(hash)
  }

  const handleCopy = () => {
    if (!deployedUrl) return
    navigator.clipboard.writeText(deployedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const live = isDeployed
  const isPublishing = publishing && !live

  return (
    <>
    <RestoreConfirmDialog
      open={confirmOpen}
      versionNumber={versionNumber}
      timeAgo={timeAgo(timestamp)}
      showPreviewHint={true}
      onConfirm={handleRestoreConfirm}
      onCancel={() => setConfirmOpen(false)}
    />
    <div className="px-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${live ? 'bg-primary/70' : 'bg-foreground/15'}`} />

        <span className="text-[11px] tabular-nums text-foreground/22">
          v{versionNumber}
        </span>

        {live && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70" style={{ letterSpacing: '0.04em' }}>
            LIVE
          </span>
        )}

        <span className="text-[11px] text-foreground/12">
          {timeAgo(timestamp)}
        </span>

        {totalVersions > 1 && (
          <>
            <span className="text-foreground/10">·</span>
            <button
              onClick={handlePreview}
              disabled={loading !== null || publishing}
              className="text-[11px] text-foreground/30 hover:text-foreground/65 transition-colors duration-100 disabled:opacity-30"
            >
              {loading === 'preview' ? '…' : 'Preview'}
            </button>
            <span className="text-foreground/10">·</span>
            <button
              onClick={handleRestoreClick}
              disabled={loading !== null || publishing}
              className="text-[11px] text-foreground/30 hover:text-foreground/65 transition-colors duration-100 disabled:opacity-30"
            >
              {loading === 'restore' ? '…' : 'Restore'}
            </button>
          </>
        )}

        {!live && (
          <>
            <span className="text-foreground/10">·</span>
            <button
              onClick={handleDeploy}
              disabled={publishing}
              className="text-[11px] text-foreground/30 hover:text-foreground/65 transition-colors duration-100 disabled:opacity-50"
              style={{ color: isPublishing ? undefined : undefined }}
            >
              {isPublishing ? 'Publishing…' : 'Publish'}
            </button>
          </>
        )}
      </div>

      {/* Deployed URL row */}
      {live && deployedUrl && (
        <div className="ml-6 flex items-center gap-2">
          <a
            href={deployedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] truncate text-primary/55 hover:text-primary/85 transition-colors duration-100"
            style={{ maxWidth: '180px' }}
          >
            {deployedUrl.replace('https://', '')}
          </a>
          <button
            onClick={handleCopy}
            title="Copy link"
            className={`flex items-center justify-center w-4 h-4 rounded transition-colors duration-100 ${copied ? 'text-primary/80' : 'text-foreground/20 hover:text-foreground/55'}`}
          >
            {copied ? '✓' : <CopyIcon />}
          </button>
          <a
            href={deployedUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in new tab"
            className="flex items-center justify-center w-4 h-4 rounded transition-colors duration-100 text-foreground/20 hover:text-foreground/55"
          >
            <ExternalIcon />
          </a>
        </div>
      )}
    </div>
    </>
  )
}
