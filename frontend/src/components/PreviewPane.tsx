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

function DesktopIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="8" rx="1.2" stroke="currentColor" strokeWidth={active ? 1.6 : 1.3}/>
      <path d="M5 10.5h4M7 10.5V12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function MobileIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="1" width="6" height="12" rx="1.2" stroke="currentColor" strokeWidth={active ? 1.6 : 1.3}/>
      <circle cx="7" cy="11" r="0.6" fill="currentColor"/>
    </svg>
  )
}

interface Checkpoint {
  hash: string
  timestamp: number
}

interface Props {
  previewUrl: string | null
  streaming: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  checkpoints: Checkpoint[]
  previewingHash: string | null
  onVersionChange: (hash: string | null) => void
}

export function PreviewPane({ previewUrl, streaming, isExpanded, onToggleExpand, checkpoints, previewingHash, onVersionChange }: Props) {
  const [loadingWord, setLoadingWord] = useState('')
  const [rotatingWord, setRotatingWord] = useState(() => LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)])
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
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

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    onVersionChange(val === '' ? null : val)
  }

  const selectedVersion = previewingHash ?? ''

  // Versions listed descending: Latest (= last checkpoint), then v(N-1)…v1
  const versionOptions = [
    { label: 'Latest', value: '' },
    ...checkpoints.slice(0, -1).map((cp, i) => ({ label: `v${i + 1}`, value: cp.hash })).reverse(),
  ]

  if (!previewUrl) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-10 shrink-0 flex items-center px-2 gap-1 bg-card border-b border-border">
          <div className="flex-1" />
        </div>
        <div className="flex flex-col items-center justify-center flex-1 bg-background gap-3">
          <div className="w-4 h-4 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
          <p className="text-muted-foreground/40 text-[12px] font-medium tracking-widest uppercase">
            {rotatingWord}…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex flex-col">

      {/* Persistent toolbar */}
      <div className="h-10 shrink-0 flex items-center px-2 gap-1 bg-card border-b border-border">
        {/* Viewport switcher */}
        <button
          onClick={() => setViewport('desktop')}
          title="Desktop view"
          className={`flex items-center justify-center w-7 h-6 rounded transition-colors duration-100 ${
            viewport === 'desktop'
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <DesktopIcon active={viewport === 'desktop'} />
        </button>
        <button
          onClick={() => setViewport('mobile')}
          title="Mobile view"
          className={`flex items-center justify-center w-7 h-6 rounded transition-colors duration-100 ${
            viewport === 'mobile'
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MobileIcon active={viewport === 'mobile'} />
        </button>

        <div className="flex-1" />

        {/* Version dropdown */}
        {checkpoints.length > 0 && (
          <select
            value={selectedVersion}
            onChange={handleVersionChange}
            className="h-6 text-[11px] px-1.5 rounded bg-muted border border-border text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer transition-colors duration-100"
          >
            {versionOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        {/* Reload */}
        <button
          onClick={handleReload}
          title="Reload preview"
          className="flex items-center justify-center w-7 h-6 rounded text-muted-foreground hover:text-foreground transition-colors duration-100"
        >
          <ReloadIcon />
        </button>

        {/* Expand / collapse */}
        <button
          onClick={onToggleExpand}
          title={isExpanded ? 'Collapse preview' : 'Expand preview'}
          className="flex items-center justify-center w-7 h-6 rounded text-muted-foreground hover:text-foreground transition-colors duration-100"
        >
          {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>

      {/* Preview area */}
      <div
        className="relative flex-1 min-h-0 overflow-hidden"
        style={{
          background: viewport === 'mobile' ? 'hsl(0 0% 4%)' : 'hsl(var(--background))',
          transition: 'background 250ms ease',
        }}
      >
        {/* Frame — absolute so left/right/top/bottom all animate together with border-radius */}
        <div
          className="absolute overflow-hidden"
          style={{
            top: viewport === 'mobile' ? '20px' : '0',
            bottom: viewport === 'mobile' ? '20px' : '0',
            left: viewport === 'mobile' ? 'max(0px, calc(50% - 187.5px))' : '0',
            right: viewport === 'mobile' ? 'max(0px, calc(50% - 187.5px))' : '0',
            borderRadius: viewport === 'mobile' ? '16px' : '0px',
            boxShadow: viewport === 'mobile'
              ? '0 0 0 1px rgba(255,255,255,0.08), 0 24px 60px rgba(0,0,0,0.7)'
              : 'none',
            transition: 'top 250ms cubic-bezier(0.4,0,0.2,1), bottom 250ms cubic-bezier(0.4,0,0.2,1), left 250ms cubic-bezier(0.4,0,0.2,1), right 250ms cubic-bezier(0.4,0,0.2,1), border-radius 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="w-full h-full border-0"
            title="Live Preview"
            allow="cross-origin-isolated"
          />
        </div>

        {/* Streaming overlay */}
        {streaming && (
          <div className="absolute inset-0 z-10 bg-black flex items-center justify-center">
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
