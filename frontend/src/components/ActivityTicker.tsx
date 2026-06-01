import { useRef, useEffect, useState } from 'react'
import {
  BookOpenIcon,
  PencilLineIcon,
  PlusIcon,
  TerminalIcon,
  MagnifyingGlassIcon,
  GlobeIcon,
  LightningIcon,
  CodeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  ScissorsIcon,
  NoteBlankIcon,
} from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

function activityIcon(label: string): PhosphorIcon {
  const l = label.toLowerCase()
  if (l.startsWith('read')) return BookOpenIcon
  if (l.startsWith('edit')) return PencilLineIcon
  if (l.startsWith('write')) return PlusIcon
  if (l.startsWith('bash') || l === 'running command') return TerminalIcon
  if (l.startsWith('search') || l === 'searching files' || l === 'searching code') return MagnifyingGlassIcon
  if (l === 'fetching url' || l.startsWith('fetching')) return GlobeIcon
  if (l === 'searching web') return GlobeIcon
  if (l === 'running task') return LightningIcon
  if (l === 'code analysis') return CodeIcon
  if (l === 'reading codebase') return FolderOpenIcon
  if (l === 'cloning repo') return GitBranchIcon
  if (l === 'applying patch') return ScissorsIcon
  return NoteBlankIcon
}

interface Props {
  items: string[]
  streaming: boolean
}

export function ActivityTicker({ items, streaming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [items, expanded])

  if (items.length === 0) return null

  const latest = items[items.length - 1] ?? 'Working…'
  const label = streaming
    ? latest
    : `${items.length} action${items.length === 1 ? '' : 's'}`
  const LatestIcon = activityIcon(latest)

  return (
    <div className="px-4">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-[11px] w-full text-left group text-muted-foreground hover:text-foreground/55 transition-colors"
      >
        {streaming && <LatestIcon size={11} weight="regular" className="shrink-0" />}
        <span className="font-mono tracking-tight flex-1 truncate">
          {label}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className="shrink-0 transition-transform duration-150 opacity-60"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {expanded && (
        <div className="mt-1.5 rounded-lg overflow-hidden relative bg-muted/50 border border-border">
          <div
            ref={listRef}
            className="max-h-[120px] overflow-y-auto py-2 px-3 space-y-0.5"
            style={{ scrollbarWidth: 'none' }}
          >
            {items.map((item, i) => {
              const Icon = activityIcon(item)
              const isLatest = i === items.length - 1
              return (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 text-[11px] font-mono leading-5 ${isLatest ? 'text-foreground/50' : 'text-foreground/22'}`}
                >
                  <Icon size={11} weight="regular" className="shrink-0 mt-px" />
                  <span className="truncate">{item}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
