import { useEffect, useRef, useState } from 'react'
import { LOADING_WORDS } from '../utility/loading-words'

function ReloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 6.5a4.5 4.5 0 1 1 1.32 3.18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 10.5V7h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M8 1.5h3.5V5M5 11.5H1.5V8M11.5 1.5l-4 4M1.5 11.5l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M5 1.5v3.5H1.5M8 11.5V8h3.5M5 5L1.5 1.5M8 8l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

interface Props {
  previewUrl: string | null
  streaming: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

export function PreviewPane({ previewUrl, streaming, isExpanded, onToggleExpand }: Props) {
  const [loadingWord, setLoadingWord] = useState('')
  const [rotatingWord, setRotatingWord] = useState(() => LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)])
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (streaming) setLoadingWord(LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)])
  }, [streaming])

  useEffect(() => {
    if (previewUrl) return
    const id = setInterval(() => {
      setRotatingWord(LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)])
    }, 2000)
    return () => clearInterval(id)
  }, [previewUrl])

  const handleReload = () => {
    if (!iframeRef.current) return
    // eslint-disable-next-line no-self-assign
    iframeRef.current.src = iframeRef.current.src
  }

  if (!previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background gap-3">
        <div className="w-4 h-4 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
        <p className="text-muted-foreground/40 text-[12px] font-medium tracking-widest uppercase">
          {rotatingWord}…
        </p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex flex-col group/preview">

      <div className="relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={previewUrl}
          className="w-full h-full border-0"
          title="Live Preview"
          allow="cross-origin-isolated"
        />

        {/* Floating toolbar */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 opacity-0 group-hover/preview:opacity-100 transition-opacity duration-150">
          <button
            onClick={handleReload}
            title="Reload preview"
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground transition-colors duration-100 bg-background/80 backdrop-blur-sm border border-border"
          >
            <ReloadIcon />
          </button>
          <button
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse preview' : 'Expand preview'}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground transition-colors duration-100 bg-background/80 backdrop-blur-sm border border-border"
          >
            {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        </div>

        {/* Streaming overlay */}
        {streaming && (
          <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-[2px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-4 h-4 border-[1.5px] border-border border-t-muted-foreground rounded-full animate-spin" />
              <p className="text-muted-foreground/35 text-[11px] font-medium tracking-widest uppercase">
                {loadingWord}…
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
