import { useState } from 'react'
import { RestoreConfirmDialog } from './RestoreConfirmDialog'
import { timeAgo } from '../utility/time'

interface Props {
  hash: string
  timestamp: number
  versionNumber: number
  totalVersions: number
  isDeployed: boolean
  publishing: boolean
  onPreview: (hash: string) => void
  onRestore: (hash: string) => void
  onDeploy: (hash: string) => Promise<string>
}


export function CheckpointCard({ hash, timestamp, versionNumber, totalVersions, isDeployed, publishing, onPreview, onRestore, onDeploy }: Props) {
  const [loading, setLoading] = useState<'preview' | 'restore' | null>(null)
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

    </div>
    </>
  )
}
