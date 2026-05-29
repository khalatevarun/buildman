import { useRef, useEffect, useState } from 'react'

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

  return (
    <div className="px-4">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-[11px] w-full text-left group text-muted-foreground hover:text-foreground/55 transition-colors"
      >
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
            {items.map((item, i) => (
              <div
                key={i}
                className={`text-[11px] font-mono leading-5 truncate ${i === items.length - 1 ? 'text-foreground/50' : 'text-foreground/22'}`}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-5 pointer-events-none bg-gradient-to-b from-transparent to-muted/90" />
        </div>
      )}
    </div>
  )
}
