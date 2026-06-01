import { useState } from 'react'
import { GlobeIcon } from '@phosphor-icons/react'
import type { Project } from '../hooks/useProjects'
import { api } from '../utility/api'
import { toast } from 'sonner'

interface Props {
  projects: Project[]
  userId: string
  onOpen: (projectId: string) => Promise<void>
  onDelete: (projectId: string) => void
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() / 1000) - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return `${Math.floor(s / (86400 * 30))}mo ago`
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 13 13" fill="none">
      <path d="M1.5 3.5h10M4.5 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5.5 6v3.5M7.5 6v3.5M2.5 3.5l.75 7a1 1 0 0 0 1 .9h4.5a1 1 0 0 0 1-.9l.75-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function ProjectList({ projects, userId, onOpen, onDelete }: Props) {
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleOpen = async (projectId: string) => {
    if (openingId || confirmId || deletingId) return
    setOpeningId(projectId)
    try {
      await onOpen(projectId)
    } finally {
      setOpeningId(null)
    }
  }

  const handleDeleteConfirm = async (projectId: string) => {
    const name = projects.find(p => p.project_id === projectId)?.name
    setConfirmId(null)
    setDeletingId(projectId)
    try {
      await api.delete(`/projects/${projectId}`, { params: { user_id: userId } })
      onDelete(projectId)
      toast.success(name ? `"${name}" has been permanently deleted` : 'Project deleted')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="w-full">
      {projects.map((project, i) => {
        const isOpening = openingId === project.project_id
        const isDeleting = deletingId === project.project_id
        const isConfirming = confirmId === project.project_id
        const busy = openingId !== null || deletingId !== null

        return (
          <div
            key={project.project_id}
            className="w-full group/row"
            style={{
              borderTop: i === 0 ? '1px solid var(--border)' : 'none',
              borderBottom: '1px solid var(--border)',
              opacity: isDeleting ? 0.4 : 1,
              transition: 'opacity 0.3s ease',
            }}
          >
            <div
              className="flex items-center gap-3 px-1 py-3 rounded-lg transition-colors duration-100 cursor-pointer hover:bg-muted/40"
              style={{ background: isOpening ? 'var(--muted)' : undefined }}
              onClick={() => !isConfirming && !busy && handleOpen(project.project_id)}
            >
              {/* Status dot or deployed link icon */}
              {project.deployed_url ? (
                <a
                  href={project.deployed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 flex items-center justify-center w-5 h-5 text-primary/60 hover:text-primary transition-colors duration-100"
                  title={project.deployed_url}
                >
                  <GlobeIcon size={15} />
                </a>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5 bg-foreground/15" />
              )}

              {/* Name */}
              <div className="flex-1 min-w-0">
                <span
                  className="text-[13px] truncate block text-foreground/75"
                  style={{ letterSpacing: '-0.01em' }}
                  title={project.name}
                >
                  {project.name}
                </span>
              </div>

              {/* Right side */}
              <div className="shrink-0 flex items-center gap-2.5">
                {isDeleting ? (
                  <span
                    className="w-3 h-3 rounded-full border border-destructive/30 border-t-destructive/80"
                    style={{ animation: 'spin 0.8s linear infinite' }}
                  />
                ) : isOpening ? (
                  <span
                    className="w-3 h-3 rounded-full border border-border border-t-muted-foreground"
                    style={{ animation: 'spin 0.8s linear infinite' }}
                  />
                ) : isConfirming ? (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <span className="text-[11px] text-foreground/35">Delete?</span>
                    <button
                      onClick={() => handleDeleteConfirm(project.project_id)}
                      className="text-[11px] px-2 py-0.5 rounded transition-colors duration-100 text-destructive/80 bg-destructive/8 hover:bg-destructive/15"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-[11px] px-2 py-0.5 rounded transition-colors duration-100 text-foreground/35 bg-muted hover:bg-muted/80"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-[11px] tabular-nums text-foreground/20">
                      {timeAgo(project.last_used_at)}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); if (!busy) setConfirmId(project.project_id) }}
                      className="opacity-0 group-hover/row:opacity-100 flex items-center justify-center w-6 h-6 rounded-md transition-all duration-100 text-foreground/20 hover:text-destructive/80 hover:bg-destructive/8"
                      title="Delete project"
                      disabled={busy}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
